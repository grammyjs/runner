import { type Update, type UserFromGetMe } from "./deps.deno.ts";
import {
    createThread,
    type ModuleSpecifier,
    type Thread,
} from "./platform.deno.ts";

class ThreadPool {
    public readonly threads: Thread<Update, number>[] = [];
    public readonly tasks = new Map<number, () => void>();

    constructor(
        specifier: ModuleSpecifier,
        me: UserFromGetMe,
        private readonly count = 4,
    ) {
        for (let i = 0; i < count; i++) {
            const thread = createThread<Update, number, UserFromGetMe>(
                specifier,
                me,
            );
            thread.onMessage((update_id) => {
                const task = this.tasks.get(update_id);
                task?.();
                this.tasks.delete(update_id);
            });
            this.threads.push(thread);
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

const workers = new Map<ModuleSpecifier, ThreadPool>();
function getWorker(
    specifier: ModuleSpecifier,
    me: UserFromGetMe,
    count?: number,
) {
    let worker = workers.get(specifier);
    if (worker === undefined) {
        worker = new ThreadPool(specifier, me, count);
        workers.set(specifier, worker);
    }
    return worker;
}

/**
 * Creates middleware that distributes updates across cores.
 *
 * This function should be used in combination with the `BotWorker` class.
 * Create an instance of `BotWorker` in a separate file. Let's assume that this
 * file is called `worker.ts`. This will define your actual bot logic.
 *
 * You can now do
 *
 * ```ts
 * const bot = new Bot("");
 *
 * // Deno:
 * bot.use(distribute(new URL("./worker.ts", import.meta.url)));
 * // Node:
 * bot.use(distribute(__dirname + "/worker"));
 * ```
 *
 * in a central place to use the bot worker in `worker.ts` and send updates to
 * it.
 *
 * Under the hood, `distribute` will create several web workers (Deno) or worker
 * threads (Node) using `worker.ts`. Updates are distributed among them in a
 * round-robin fashion.
 *
 * You can adjust the number of workers via `count` in an options object which
 * is passed as a second argument, i.e. `distribute(specifier, { count: 8 })`.
 * By default, 4 workers are created.
 *
 * @param specifier Module specifier to a file which creates a `BotWorker`
 * @param options Further options to control the number of workers
 */
export function distribute<
    C extends { update: { update_id: number }; me: UserFromGetMe },
>(
    specifier: ModuleSpecifier,
    options?: {
        /** Number of workers to create */
        count?: number;
    },
) {
    const count = options?.count;
    return (ctx: C) => getWorker(specifier, ctx.me, count).process(ctx.update);
}
