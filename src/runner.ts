import {
    createConcurrentSink,
    type SinkOptions,
    type UpdateConsumer,
    type UpdateSink,
} from "./sink.ts";
import {
    createSource,
    type SourceOptions,
    type UpdateSource,
    type UpdateSupplier,
} from "./source.ts";

/**
 * Options to be passed to `run(bot, options)`. Collects the options for the
 * underlying update source, runner, and update sink.
 */
export interface RunOptions<Y> {
    /**
     * Options that influence the behavior of the update source.
     */
    source?: SourceOptions;
    /**
     * Options that influence the behavior of the runner which connects source and sink.
     */
    runner?: RunnerOptions;
    /**
     * Options that influence the behavior of the sink that processes the updates.
     */
    sink?: SinkOptions<Y>;
}

/**
 * Options to be passed to the runner created internally by `run(bot)`.
 */
export interface RunnerOptions {
    /**
     * Options that can be passed when fetching new updates. All options here are
     * simply forwarded to `getUpdates`. The runner itself does not do anything
     * with them.
     */
    fetch?: FetchOptions;
    /**
     * When a call to `getUpdates` fails, this option specifies the number of
     * milliseconds that the runner should keep on retrying the calls.
     */
    maxRetryTime?: number;
    /**
     * Time to wait between retries of calls to `getUpdates`. Can be a number of
     * milliseconds to wait. Can be 'exponential' or 'quadratic' for increasing
     * backoff starting at 100 milliseconds.
     */
    retryInterval?: "exponential" | "quadratic" | number;
    /**
     * The runner logs all errors from `getUpdates` calls via `console.error`.
     * Set this option to `false` to suppress output.
     */
    silent?: boolean;
}

/**
 * Options that can be passed to the call to `getUpdates` when the runner
 * fetches new a new batch of updates.
 *
 * Corresponds to the options mentioned in
 * https://core.telegram.org/bots/api#getupdates but without the parameters that
 * the runner controls.
 */
export interface FetchOptions {
    /**
     * Timeout in seconds for long polling. Defaults to 30.
     */
    timeout?: number;
    /**
     * A list of the update types you want your bot to receive. For example,
     * specify `["message", "edited_channel_post", "callback_query"]` to only
     * receive updates of these types. See
     * [Update](https://core.telegram.org/bots/api#update) for a complete list
     * of available update types. Specify an empty list to receive all update
     * types except `chat_member` (default). If not specified, the previous
     * setting will be used.
     */
    allowed_updates?: string[];
}

/**
 * This handle gives you control over a runner. It allows you to stop the bot,
 * start it again, and check whether it is running.
 */
export interface RunnerHandle {
    /**
     * Starts the bot. Note that calling `run` will automatically do this for
     * you, so you only have to call `start` if you create a runner yourself
     * with `createRunner`.
     */
    start: () => void;
    /**
     * Stops the bot. The bot will no longer fetch updates from Telegram, and it
     * will interrupt the currently pending `getUpdates` call.
     *
     * This method returns a promise that will resolve as soon as all currently
     * running middleware is done executing. This means that you can `await
     * handle.stop()` to be sure that your bot really stopped completely.
     */
    stop: () => Promise<void>;
    /**
     * Returns the size of the underlying update sink. This number is equal to
     * the number of updates that are currently being processed. The size does
     * not count updates that have completed, errored, or timed out.
     */
    size: () => number;
    /**
     * Returns a promise that resolves as soon as the runner stops, either by
     * being stopped or by crashing. If the bot crashes, it means that the error
     * handlers installed on the bot re-threw the error, in which case the bot
     * terminates. A runner handle does not give you access to errors thrown by
     * the bot. Returns `undefined` if and only if `isRunning` returns `false`.
     */
    task: () => Promise<void> | undefined;
    /**
     * Determines whether the bot is currently running or not. Note that this
     * will return `false` as soon as you call `stop` on the handle, even though
     * the promise returned by `stop` may not have resolved yet.
     */
    isRunning: () => boolean;
}

/**
 * Adapter interface that specifies a minimal structure a bot has to obey in
 * order for `run` to be able to run it. All grammY bots automatically conform
 * with this structure.
 */
interface BotAdapter<Y, R> {
    init?: () => Promise<void>;
    handleUpdate: (update: Y) => Promise<void>;
    errorHandler: (error: R) => unknown;
    api: {
        getUpdates: (
            args: { offset: number; limit: number; timeout: number },
            signal: AbortSignal,
        ) => Promise<Y[]>;
    };
}

/**
 * Runs a grammY bot with long polling. Updates are processed concurrently with
 * a default maximum concurrency of 500 updates. Calls to `getUpdates` will be
 * slowed down and the `limit` parameter will be adjusted as soon as this load
 * limit is reached.
 *
 * You should use this method if your bot processes a lot of updates (several
 * thousand per hour), or if your bot has long-running operations such as large
 * file transfers.
 *
 * Confer the grammY [documentation](https://grammy.dev/plugins/runner.html) to
 * learn more about how to scale a bot with grammY.
 *
 * @param bot A grammY bot
 * @param options Further configuration options
 * @returns A handle to manage your running bot
 */
export function run<Y extends { update_id: number }, R>(
    bot: BotAdapter<Y, R>,
    options: RunOptions<Y> = {},
): RunnerHandle {
    const { source: sourceOpts, runner: runnerOpts, sink: sinkOpts } = options;

    // create update fetch function
    const fetchUpdates = createUpdateFetcher(bot, runnerOpts);

    // create source
    const supplier: UpdateSupplier<Y> = {
        supply: async function (batchSize, signal) {
            if (bot.init !== undefined) await bot.init();
            const updates = await fetchUpdates(batchSize, signal);
            supplier.supply = fetchUpdates;
            return updates;
        },
    };
    const source = createSource(supplier, sourceOpts);

    // create sink
    const consumer: UpdateConsumer<Y> = {
        consume: (update) => bot.handleUpdate(update),
    };
    const sink = createConcurrentSink<Y, R>(consumer, async (error) => {
        try {
            await bot.errorHandler(error);
        } catch (error) {
            printError(error);
        }
    }, sinkOpts);

    // launch
    const runner = createRunner(source, sink);
    runner.start();
    return runner;
}

/**
 * Takes a grammY bot and returns an update fetcher function for it. The
 * returned function has built-in retrying behavior that can be configured.
 * After every successful fetching operation, the `offset` parameter is
 * correctly incremented. As a result, you can simply invoke the created function
 * multiple times in a row, and you will obtain new updates every time.
 *
 * The update fetcher function has a default long polling timeout of 30 seconds.
 * Specify `sourceOptions` to configure what values to pass to `getUpdates`
 * calls.
 *
 * @param bot A grammY bot
 * @param options Further options on how to fetch updates
 * @returns A function that can fetch updates with automatic retry behavior
 */
export function createUpdateFetcher<Y extends { update_id: number }, R>(
    bot: BotAdapter<Y, R>,
    options: RunnerOptions = {},
) {
    const {
        fetch: fetchOpts,
        retryInterval = "exponential",
        maxRetryTime = 15 * 60 * 60 * 1000, // 15 hours in milliseconds
        silent,
    } = options;
    const backoff: (t: number) => number = retryInterval === "exponential"
        ? (t) => t + t
        : retryInterval === "quadratic"
        ? (t) => t + 100
        : (t) => t;
    const initialRetryIn = typeof retryInterval === "number"
        ? retryInterval
        : 100;

    let offset = 0;
    async function fetchUpdates(batchSize: number, signal: AbortSignal) {
        const args = {
            timeout: 30,
            ...fetchOpts,
            offset,
            limit: Math.max(1, Math.min(batchSize, 100)), // 1 <= batchSize <= 100
        };

        const latestRetry = Date.now() + maxRetryTime;
        let retryIn = initialRetryIn;

        let updates: Y[] | undefined;
        do {
            try {
                updates = await bot.api.getUpdates(args, signal);
            } catch (error) {
                // do not retry if stopped
                if (signal.aborted) throw error;

                if (!silent) {
                    console.error(
                        "[grammY runner] Error while fetching updates:",
                    );
                    console.error("[grammY runner]", error);
                }

                // preventing retries on unrecoverable errors
                await throwIfUnrecoverable(error);

                if (Date.now() + retryIn < latestRetry) {
                    await new Promise((r) => setTimeout(r, retryIn));
                    retryIn = backoff(retryIn);
                } else {
                    // do not retry for longer than `maxRetryTime`
                    throw error;
                }
            }
        } while (updates === undefined);

        const lastId = updates[updates.length - 1]?.update_id;
        if (lastId !== undefined) offset = lastId + 1;
        return updates;
    }

    return fetchUpdates;
}

/**
 * Creates a runner that pulls in updates from the supplied source, and passes
 * them to the supplied sink. Returns a handle that lets you control the runner,
 * e.g. start it.
 *
 * @param source The source of updates
 * @param sink The sink for updates
 * @returns A handle to start and manage your bot
 */
export function createRunner<Y>(
    source: UpdateSource<Y>,
    sink: UpdateSink<Y>,
): RunnerHandle {
    let running = false;
    let task: Promise<void> | undefined;

    async function runner(): Promise<void> {
        if (!running) return;
        try {
            for await (const updates of source.generator()) {
                const capacity = await sink.handle(updates);
                if (!running) break;
                source.setGeneratorPace(capacity);
            }
        } catch (e) {
            // Error is thrown when `stop` is called, so we only rethrow the
            // error if the bot was not already stopped intentionally before.
            if (running) {
                running = false;
                task = undefined;
                throw e;
            }
        }
        running = false;
        task = undefined;
    }

    return {
        start: () => {
            running = true;
            task = runner();
        },
        size: () => sink.size(),
        stop: () => {
            const t = task!;
            running = false;
            task = undefined;
            source.close();
            return t;
        },
        task: () => task,
        isRunning: () => running && source.isActive(),
    };
}

async function throwIfUnrecoverable(err: unknown) {
    if (typeof err !== "object" || err === null) return;
    const code = "error_code" in err ? err.error_code : undefined;
    if (code === 401 || code === 409) throw err; // unauthorized or conflict
    if (code === 429) {
        // server is closing, must wait some seconds
        if (
            "parameters" in err &&
            typeof err.parameters === "object" &&
            err.parameters !== null &&
            "retry_after" in err.parameters &&
            typeof err.parameters.retry_after === "number"
        ) {
            const delay = err.parameters.retry_after;
            await new Promise((r) => setTimeout(r, 1000 * delay));
        }
    }
}

function printError(error: unknown) {
    console.error("::: ERROR ERROR ERROR :::");
    console.error();
    console.error("The error handling of your bot threw");
    console.error("an error itself! Make sure to handle");
    console.error("all errors! Time:", new Date().toISOString());
    console.error();
    console.error("The default error handler rethrows all");
    console.error("errors. Did you maybe forget to set");
    console.error("an error handler with `bot.catch`?");
    console.error();
    console.error("Here is your error object:");
    console.error(error);
}
