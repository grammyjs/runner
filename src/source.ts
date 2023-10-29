const STAT_LEN = 16;

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
     * Requests the next batch of updates of the specified size and returns them
     * as an array. The request should respect the given `AbortSignal`. If the
     * signal is raised, the currently pending request must be cancelled.
     */
    supply: (batchSize: number, signal: AbortSignal) => Promise<Y[]>;
}

/**
 * An update source is an object that acts as the source of updates for a
 * runner. It features an async generator of updates that produces batches of
 * updates in the form of arrays.
 *
 * The size of the batches can be adjusted on the fly by setting the generator
 * pace. This will prevent the generator from yielding more than the specified
 * number of updates. It may yield fewer updates.
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
    generator(): AsyncGenerator<Y[]>;
    /**
     * Sets the maximal pace of the generator. This limits how many updates the
     * generator will yield.
     *
     * @param pace A positive integer that sets the maximal generator pace
     */
    setGeneratorPace(pace: number): void;
    /**
     * Returns whether the source is currently active.
     */
    isActive(): boolean;
    /**
     * Closes the source, i.e. interrupts the current request for more updates.
     * The source can be re-opened by simply beginning to iterate over the
     * generator again.
     */
    close(): void;
}

/**
 * Options controlling how the update source operates.
 */
export interface SourceOptions {
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
     * Defines a hard limit for the duration that the runner waits between calls
     * to `getUpdates`.
     *
     * Note that by default, the runner does not wait at all between these
     * calls. This is because if the speed traffic balance is set to `0.0`
     * (which is also the default), the next update is always fetched
     * immediately after the previous one is received.
     *
     * Defaults to 500 milliseconds.
     */
    maxDelayMilliseconds?: number;
}

/**
 * Creates an update source based on the given update supplier.
 *
 * @param supplier An update supplier to use for requesting updates
 * @returns An update source
 */
export function createSource<Y>(
    supplier: UpdateSupplier<Y>,
    options: SourceOptions = {},
): UpdateSource<Y> {
    const { speedTrafficBalance = 0.0, maxDelayMilliseconds = 500 } = options;

    let active = false;
    let endWait = () => {};
    let waitHandle: number | undefined = undefined;
    let controller: AbortController;
    function deactivate() {
        active = false;
        clearTimeout(waitHandle);
        waitHandle = undefined;
        endWait();
    }
    let updateGenerator = worker();
    let pace = Infinity;

    const bounded = Math.max(0.0, Math.min(speedTrafficBalance, 1.0)); // [0;1]
    const balance = 100 * bounded / Math.max(1, maxDelayMilliseconds); // number of wanted updates per call
    // We take two cyclic buffers to store update counts and durations
    // for the last STAT_LEN update calls.
    const counts = Array(STAT_LEN).fill(100);
    const durations = Array(STAT_LEN).fill(1);
    // We also keep track of the sum of the values in each buffer
    let totalCounts = 100 * STAT_LEN; // sum of counts
    let totalDuration = 1 * STAT_LEN; // sum of durations
    // Write index for both buffers
    let index = 0;
    /** Records a pair ms/items and estimates the pause length */
    const record = balance === 0
        ? () => 0 // do not perform any tracking if the balance is 0.0
        : (newCount: number, newDuration: number) => {
            // save old
            const oldCount = counts[index];
            const oldDuration = durations[index];
            // write to buffer
            counts[index] = newCount;
            durations[index] = newDuration;
            // update sums
            totalCounts += newCount - oldCount;
            totalDuration += newDuration - oldDuration;
            // move index
            index = (index + 1) % STAT_LEN;
            // estimate time to wait, and cap it smoothly at maxDelay
            const estimate = balance * totalDuration / (totalCounts || 1);
            const capped = maxDelayMilliseconds * Math.tanh(estimate);
            return capped;
        };

    async function* worker() {
        active = true;
        let last = Date.now();
        do {
            controller = new AbortController();
            controller.signal.addEventListener("abort", deactivate);
            try {
                const items = await supplier.supply(pace, controller.signal);
                const now = Date.now();
                yield items;
                const wait = record(items.length, now - last);
                last = Date.now();
                if (wait > 0 && items.length < 100) {
                    await new Promise<void>((r) => {
                        endWait = r;
                        waitHandle = setTimeout(r, wait);
                    });
                }
            } catch (e) {
                close();
                if (!controller.signal.aborted) throw e;
                break;
            }
        } while (active);
    }
    function close() {
        deactivate();
        controller.abort();
        updateGenerator = worker();
        pace = Infinity;
    }

    return {
        generator: () => updateGenerator,
        setGeneratorPace: (newPace) => pace = newPace,
        isActive: () => active,
        close: () => close(),
    };
}
