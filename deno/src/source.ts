/**
 * Update suppliers are objects that can fetch a number of new updates from the
 * Telegram Bot API. When you call `run(bot)`, such an object will be created
 * automatically for you. It uses the passed bot to fetch updates.
 *
 * If you want to poll updates from a different source, such as a message queue,
 * you can construct your own update source by passing a custom update supplier.
 */
export interface UpdateSupplier<Y> {
    /**
     * Requests the next batch of updates and returns them as an array. The
     * request should respect the given `AbortSignal`. If the signal is raised,
     * the currently pending request must be cancelled.
     */
    supply: (signal: AbortSignal) => Promise<Y[]>
}

/**
 * An update source is an object that acts as the source of updates for a
 * runner. It features an async generator of updates that produces batches of
 * updates in the form of arrays.
 *
 * Update sources can be closed. If you are currently polling updates from the
 * async iterator, closing the update source will raise an abort signal.
 *
 * If you then want to start pulling updates from the source again, you can
 * simply begin iterating over the generator again.
 *
 * An active flag signals whether the update source is currently active (pulling
 * in updates) or whether it has been terminated.
 */
export interface UpdateSource<Y> {
    /**
     * Returns this source's async generator.
     */
    generator: () => AsyncGenerator<Y[]>
    /**
     * Returns whether the source is currently active.
     */
    isActive: () => boolean
    /**
     * Closes the source, i.e. interrupts the current request for more updates.
     * The source can be re-opened by simply beginning to iterate over the
     * generator again.
     */
    close: () => void
}

/**
 * Creates an update source based on the given update supplier.
 *
 * @param supplier an update supplier to use for requesting updates
 * @returns an update source
 */
export function createSource<Y>(supplier: UpdateSupplier<Y>): UpdateSource<Y> {
    let active = false
    let controller: AbortController
    const listener = () => {
        active = false
    }
    let w = worker()

    async function* worker() {
        active = true
        do {
            controller = new AbortController()
            controller.signal.addEventListener('abort', listener)
            try {
                yield await supplier.supply(controller.signal)
            } catch (e) {
                close()
            }
        } while (!controller.signal.aborted)
    }
    function close() {
        active = false
        controller.abort()
        w = worker()
    }

    return {
        generator: () => w,
        isActive: () => active,
        close: () => close(),
    }
}
