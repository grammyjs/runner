import { type Update } from "./deps.deno.ts";
import { createThread, type Thread } from "./platform.deno.ts";

class UpdateThread {
    public readonly threads: Thread<number, Update>[] = [];
    public readonly tasks = new Map<number, () => void>();

    constructor(specifier: string | URL, private readonly count = 4) {
        for (let i = 0; i < count; i++) {
            const worker = createThread<Update, number>(specifier);
            worker.onMessage((update_id) => {
                const task = this.tasks.get(update_id);
                task?.();
                this.tasks.delete(update_id);
            });
            this.threads.push(worker);
        }
    }

    async process(update: { update_id: number }) {
        const i = update.update_id % this.count;
        this.threads[i].postMessage(update);
        await new Promise<void>((resolve) => {
            this.tasks.set(update.update_id, resolve);
        });
    }
}

const workers = new Map<string | URL, UpdateThread>();
function getWorker(specifier: string | URL, count?: number) {
    let worker = workers.get(specifier);
    if (worker === undefined) {
        worker = new UpdateThread(specifier, count);
        workers.set(specifier, worker);
    }
    return worker;
}

export function distribute<C extends { update: { update_id: number } }>(
    specifier: string | URL,
    options?: { count?: number },
) {
    const worker = getWorker(specifier, options?.count);
    return (ctx: C) => worker.process(ctx.update);
}
