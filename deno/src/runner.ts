import { createParallelSink, UpdateSink } from './sink.ts'
import { createSource, UpdateSource } from './source.ts'

export interface RunnerHandle {
    start: () => void
    stop: () => Promise<void>
    isRunning: () => boolean
}

interface BotAdapter<Y, R> {
    handleUpdate: (update: Y) => Promise<void>
    errorHandler: (error: R) => unknown
    api: {
        getUpdates: ({}, signal: AbortSignal) => Promise<Y[]>
    }
}

export function run<Y, R>(bot: BotAdapter<Y, R>): RunnerHandle {
    // create source
    const source = createSource({
        supply: signal => bot.api.getUpdates({}, signal),
    })
    // create sink
    const sink = createParallelSink<Y, R>(
        { consume: update => bot.handleUpdate(update) },
        async error => {
            try {
                await bot.errorHandler(error)
            } catch (error) {
                printError(error)
            }
        }
    )
    // launch
    const runner = createRunner(source, sink)
    runner.start()
    return runner
}

export function createRunner<Y>(
    source: UpdateSource<Y>,
    sink: UpdateSink<Y>
): RunnerHandle {
    let running = false
    let task: Promise<void> | undefined

    async function runner(): Promise<void> {
        if (!running) return
        try {
            for await (const updates of source.generator) {
                await sink.handle(updates)
                if (!running) break
            }
        } finally {
            running = false
        }
    }

    return {
        start: () => {
            running = true
            task = runner()
        },
        stop: async () => {
            running = false
            source.close()
        },
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
