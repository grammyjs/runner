import { DecayingDeque } from './queue.ts'

export interface UpdateConsumer<Y> {
    consume: (update: Y) => Promise<void>
}

export interface UpdateSink<Y> {
    handle: (updates: Y[]) => Promise<number>
}

export interface SinkOptions<Y> {
    timeout: number
    timeoutHandler: (update: Y, task: Promise<void>) => void
}

export function createSequentialSink<Y, R = unknown>(
    handler: UpdateConsumer<Y>,
    errorHandler: (error: R) => Promise<void>,
    options: SinkOptions<Y> = { timeout: Infinity, timeoutHandler: () => {} }
): UpdateSink<Y> {
    const q = new DecayingDeque(
        options.timeout,
        handler.consume,
        false,
        errorHandler,
        options.timeoutHandler
    )
    return {
        handle: async updates => {
            const len = updates.length
            for (let i = 0; i < len; i++) await q.add([updates[i]!])
            return Infinity
        },
    }
}

export function createBatchSink<Y, R = unknown>(
    handler: UpdateConsumer<Y>,
    errorHandler: (error: R) => Promise<void>,
    options: SinkOptions<Y> = { timeout: Infinity, timeoutHandler: () => {} }
): UpdateSink<Y> {
    const q = new DecayingDeque(
        options.timeout,
        handler.consume,
        false,
        errorHandler,
        options.timeoutHandler
    )
    const constInf = () => Infinity
    return {
        handle: updates => q.add(updates).then(constInf),
    }
}

export function createParallelSink<Y, R = unknown>(
    handler: UpdateConsumer<Y>,
    errorHandler: (error: R) => Promise<void>,
    options: SinkOptions<Y> = { timeout: Infinity, timeoutHandler: () => {} }
): UpdateSink<Y> {
    const q = new DecayingDeque(
        options.timeout,
        handler.consume,
        500,
        errorHandler,
        options.timeoutHandler
    )
    return {
        handle: updates => q.add(updates),
    }
}
