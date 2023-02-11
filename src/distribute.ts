import { type Update, type UserFromGetMe } from "./deps.deno.ts";
import {
    createThread,
    type ModuleSpecifier,
    type Thread,
} from "./platform.deno.ts";

class UpdateThread {
    public readonly threads: Thread<Update, number>[] = [];
    public readonly tasks = new Map<number, () => void>();

    constructor(
        specifier: ModuleSpecifier,
        me: UserFromGetMe,
        private readonly count = 4,
    ) {
        for (let i = 0; i < count; i++) {
            const worker = createThread<Update, number, UserFromGetMe>(
                specifier,
                me,
            );
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

const workers = new Map<ModuleSpecifier, UpdateThread>();
function getWorker(
    specifier: ModuleSpecifier,
    me: UserFromGetMe,
    count?: number,
) {
    let worker = workers.get(specifier);
    if (worker === undefined) {
        worker = new UpdateThread(specifier, me, count);
        workers.set(specifier, worker);
    }
    return worker;
}

export function distribute<
    C extends { update: { update_id: number }; me: UserFromGetMe },
>(
    specifier: ModuleSpecifier,
    options?: { count?: number },
) {
    const count = options?.count;
    return (ctx: C) => getWorker(specifier, ctx.me, count).process(ctx.update);
}
