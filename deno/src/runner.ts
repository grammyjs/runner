import { createConcurrentSink, SinkOptions, UpdateSink } from './sink.ts'
import { createSource, UpdateSource, UpdateSupplier } from './source.ts'

/**
 * This handle gives you control over a runner. It allows you to stop the bot,
 * start it again, and check whether it is running.
 */
export interface RunnerHandle {
    /**
     * Starts the bot. Note that calling `run` will automatically do this for you,
     * so you only have to call `start` if you create a runner yourself with
     * `createRunner`.
     */
    start: () => void
    /**
     * Stops the bot. The bot will no longer fetch updates from Telegram, and it
     * will interrupt the currently pending `getUpdates` call.
     *
     * This method returns a promise that will resolve as soon as all currently
     * running middleware is done executing. This means that you can `await
     * handle.stop()` to be sure that your bot really stopped completely.
     */
    stop: () => Promise<void>
    /**
     * Returns a promise that resolves as soon as the runner stops, either by
     * being stopped or by crashing. If the bot crashes, it means that the error
     * handlers installed on the bot re-threw the error, in which case the bot
     * terminates. A runner handle does not give you access to errors thrown by
     * the bot. Returns `undefined` if and only if `isRunning` returns `false`.
     */
    task: () => Promise<void> | undefined
    /**
     * Determines whether the bot is currently running or not. Note that this
     * will return `false` as soon as you call `stop` on the handle, even though
     * the promise returned by `stop` may not have resolved yet.
     */
    isRunning: () => boolean
}

/**
 * Adapter interface that specifies a minimal structure a bot has to obey in
 * order for `run` to be able to run it. All grammY bot automatically conform
 * with this structure.
 */
interface BotAdapter<Y, R> {
    init?: () => Promise<void>
    handleUpdate: (update: Y) => Promise<void>
    errorHandler: (error: R) => unknown
    api: {
        getUpdates: (
            args: { offset: number; limit: number; timeout: number },
            signal: AbortSignal
        ) => Promise<Y[]>
    }
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
 * Confer the grammY documentation to learn more about how to scale a bot with
 * grammY.
 *
 * @param bot a grammY bot
 * @param concurrency maximal number of updates to process concurrently
 * @param sourceOptions options to pass to `getUpdates` calls
 * @param sinkOptions further configuration options
 * @returns a handle to manage your running bot
 */
export function run<Y extends { update_id: number }, R>(
    bot: BotAdapter<Y, R>,
    concurrency = 500,
    sourceOptions: any = {},
    sinkOptions: SinkOptions<Y> = {
        timeout: Infinity,
        timeoutHandler: () => {},
    }
): RunnerHandle {
    let offset = 0
    async function fetchUpdates(batchSize: number, signal: AbortSignal) {
        const limit = Math.max(100, Math.min(1, batchSize))
        const args = {
            timeout: 30,
            ...sourceOptions,
            offset,
            limit,
        }
        const updates = await bot.api.getUpdates(args, signal)
        const lastId = updates[updates.length - 1]?.update_id
        if (lastId !== undefined) offset = lastId + 1
        return updates
    }

    // create source
    const source = createSource({
        supply: async function (batchSize, signal) {
            if (bot.init !== undefined) await bot.init()
            const updates = await fetchUpdates(batchSize, signal)
            this.supply = fetchUpdates
            return updates
        },
    })

    // create sink
    const sink = createConcurrentSink<Y, R>(
        { consume: update => bot.handleUpdate(update) },
        async error => {
            try {
                await bot.errorHandler(error)
            } catch (error) {
                printError(error)
            }
        },
        concurrency,
        sinkOptions
    )
    // launch
    const runner = createRunner(source, sink)
    runner.start()
    return runner
}

/**
 * Creates a runner that pulls in updates from the supplied source, and passes
 * them to the supplied sink. Returns a handle that lets you control the runner,
 * e.g. start it.
 *
 * Note that once you stop the runner, it will close its update source.
 *
 * @param source the source of updates
 * @param sink the sink for updates
 * @returns a handle to start and manage your bot
 */
export function createRunner<Y>(
    source: UpdateSource<Y>,
    sink: UpdateSink<Y>
): RunnerHandle {
    let running = false
    let task: Promise<void> | undefined

    async function runner(): Promise<void> {
        if (!running) return
        try {
            for await (const updates of source.generator()) {
                const capacity = await sink.handle(updates)
                if (!running) break
                source.setGeneratorPace(capacity)
            }
        } catch (e) {
            // Error is thrown when `stop` is called, so we just leave this
            // empty. Custom errors should be handled by the bot before they
            // reach us. This is the case for the default `run` implementation.
        }
        running = false
        task = undefined
    }

    return {
        start: () => {
            running = true
            task = runner()
        },
        stop: () => {
            const t = task!
            running = false
            task = undefined
            source.close()
            return t
        },
        task: () => task,
        isRunning: () => running && source.isActive(),
    }
}

function printError(error: unknown) {
    console.error('::: ERROR ERROR ERROR :::')
    console.error()
    console.error('The error handling of your bot threw')
    console.error('an error itself! Make sure to handle')
    console.error('all errors! Time:', new Date().toISOString())
    console.error()
    console.error('The default error handler rethrows all')
    console.error('errors. Did you maybe forget to set')
    console.error('an error handler with `bot.catch`?')
    console.error()
    console.error('Here is your error object:')
    console.error(error)
}
