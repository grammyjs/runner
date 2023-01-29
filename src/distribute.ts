class UpdateWorker {
    public readonly workers: Worker[] = [];
    public readonly tasks = new Map<number, () => void>();

    constructor(specifier: string | URL, private readonly count = 4) {
        for (let i = 0; i < count; i++) {
            const worker = new Worker(
                new URL(specifier, import.meta.url).href,
                {
                    type: "module",
                },
            );
            worker.onmessage = (e: MessageEvent<number>) => {
                const update_id = e.data;
                const task = this.tasks.get(update_id);
                task?.();
                this.tasks.delete(update_id);
            };
            this.workers.push(worker);
        }
    }

    async process(update: { update_id: number }) {
        this.workers[update.update_id % this.count].postMessage(update);
        await new Promise<void>((resolve) => {
            this.tasks.set(update.update_id, resolve);
        });
    }
}

const workers = new Map<string | URL, UpdateWorker>();
function getWorker(specifier: string | URL) {
    let worker = workers.get(specifier);
    if (worker === undefined) {
        worker = new UpdateWorker(specifier);
        workers.set(specifier, worker);
    }
    return worker;
}

export function distribute<C extends { update: { update_id: number } }>(
    specifier: string | URL,
) {
    const worker = getWorker(specifier);
    return (ctx: C) => worker.process(ctx.update);
}
