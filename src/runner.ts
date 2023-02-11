import { createConcurrentSink, SinkOptions, UpdateSink } from "./sink.ts";
import { createSource, UpdateSource } from "./source.ts";

/**
 * Options to be passed to `run(bot)`,
 */
export interface RunnerOptions {
    /**
     * By default, the runner tries to pull in updates as fast as possible. This
     * means that the bot keeps the response times as short as possible. In
     * other words, the runner optimizes for high speed.
     *
     * However, a consequence of this is that the runner fetches many small
     * update batches from Telegram. This can increase the network traffic
     * substantially.
     *
     * You can use this option to decide on a scale from `0.0` to `1.0` (both
     * inclusive) if the runner should optimize for high speed or for low
     * network traffic. Specify `0.0` to fetch updates as fast as possible.
     * Specify `1.0` to fetch updates as efficiently as possible.
     *
     * Defaults to `0.0`.
     */
    speedTrafficBalance?: number;
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
 * @param concurrency Maximal number of updates to process concurrently
 * @param sourceOptions Options to pass to `getUpdates` calls
 * @param runnerOptions Options for retry behavior of `getUpdates` calls
 * @param sinkOptions Further configuration options
 * @returns A handle to manage your running bot
 */
export function run<Y extends { update_id: number }, R>(
    bot: BotAdapter<Y, R>,
    concurrency = 500,
    sourceOptions: any = {},
    runnerOptions: RunnerOptions = {},
    sinkOptions: SinkOptions<Y> = {
        timeout: Infinity,
        timeoutHandler: () => {},
    },
): RunnerHandle {
    runnerOptions.maxRetryTime ??= 15 * 60 * 60 * 1000; // 15 hours in milliseconds
    runnerOptions.retryInterval ??= "exponential";
    runnerOptions.speedTrafficBalance ??= 0; // speed

    // create update fetch function
    const fetchUpdates = createUpdateFetcher(
        bot,
        runnerOptions.maxRetryTime,
        runnerOptions.retryInterval,
        sourceOptions,
        runnerOptions.silent,
    );

    // create source
    const source = createSource({
        supply: async function (batchSize, signal) {
            if (bot.init !== undefined) await bot.init();
            const updates = await fetchUpdates(batchSize, signal);
            this.supply = fetchUpdates;
            return updates;
        },
    }, runnerOptions.speedTrafficBalance);

    // create sink
    const sink = createConcurrentSink<Y, R>(
        { consume: (update) => bot.handleUpdate(update) },
        async (error) => {
            try {
                await bot.errorHandler(error);
            } catch (error) {
                printError(error);
            }
        },
        concurrency,
        sinkOptions,
    );

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
 * @param maxRetryTime Maximum time to keep on retrying before throwing
 * @param retryInterval In what intervals to perform retries
 * @param sourceOptions Arbitrary options to pass on to the calls
 * @param silent Suppress logging errors to `console.error`
 * @returns A function that can fetch updates with automatic retry behavior
 */
export function createUpdateFetcher<Y extends { update_id: number }, R>(
    bot: BotAdapter<Y, R>,
    maxRetryTime: number,
    retryInterval: "exponential" | "quadratic" | number,
    sourceOptions: any,
    silent = false,
) {
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
            ...sourceOptions,
            offset,
            limit: Math.max(1, Math.min(100, batchSize)),
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

async function throwIfUnrecoverable(err: any) {
    if (typeof err !== "object" || err === null) return;
    const code = err.error_code;
    if (code === 401 || code === 409) throw err; // unauthorized or conflict
    if (code === 429) {
        // server is closing, must wait some seconds
        const delay = err.parameters?.retry_after;
        if (typeof delay === "number") {
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
