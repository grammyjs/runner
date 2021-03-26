export interface UpdateSupplier<Y> {
    supply: (signal: AbortSignal) => Promise<Y[]>
}

export interface UpdateSource<Y> {
    generator: AsyncGenerator<Y[]>
    isActive: () => boolean
    close: () => void
}

export function createSource<Y>(producer: UpdateSupplier<Y>): UpdateSource<Y> {
    const controller = new AbortController()
    async function* worker() {
        while (!controller.signal.aborted) {
            try {
                yield await producer.supply(controller.signal)
            } catch (e) {
                controller.abort()
            }
        }
    }
    return {
        generator: worker(),
        isActive: () => !controller.signal.aborted,
        close: () => controller.abort(),
    }
}
