import {
    type Api,
    Bot,
    type BotConfig,
    BotError,
    type Context,
    type Update,
    type UserFromGetMe,
} from "./deps.deno.ts";
import { parentThread } from "./platform.deno.ts";

/**
 * A `BotWorker` instance is a like a `Bot` instance in the sense that it can
 * process updates. It is different from `Bot` because it cannot pull in these
 * updates, so it cannot be be started or stopped. Instead, it has to receive
 * these updates from a central Bot instance that fetches updates.
 *
 * Create an instance of this class in a separate file.
 *
 * ```ts
 * // worker.ts
 * const bot = new BotWorker(""); // <-- pass your bot token here (again)
 *
 * bot.on("message", (ctx) => ctx.reply("yay!"));
 * ```
 *
 * This is the place where you should define all your bot logic. Install
 * plugins, add handlers, process messages and other updates. Basically, instead
 * of creating a bot, you only create a bot worker.
 *
 * Next, you can define a very minimal central bot instance to pull in updates.
 * You can use this central instance to sequentialize your updates. However, it
 * generally makes sense to put as little logic as possible in it.
 *
 * Install the `distribute` middleware exported from grammY runner to send the
 * updates to your bot workers.
 *
 * Note that any plugins you install in the central bot instance will not be
 * available inside the bot worker. In face, you can even use different context
 * types in the central bot instance and in your bot workers.
 */
export class BotWorker<
    C extends Context = Context,
    A extends Api = Api,
> extends Bot<C, A> {
    constructor(
        public readonly token: string,
        config?: BotConfig<C>,
    ) {
        super(token, config);
        const p = parentThread<number, Update, UserFromGetMe>();
        p.seed.then((me) => {
            if (!this.isInited()) {
                this.botInfo = me;
            }
        });
        p.onMessage(async (update: Update) => {
            try {
                await this.handleUpdate(update);
            } catch (err) {
                // should always be true
                if (err instanceof BotError) {
                    await this.errorHandler(err);
                } else {
                    console.error(
                        "FATAL: grammY worker unable to handle:",
                        err,
                    );
                    throw err;
                }
            } finally {
                p.postMessage(update.update_id);
            }
        });
        this.start = () => {
            throw new Error("Cannot start a bot worker!");
        };
        this.stop = () => {
            throw new Error("Cannot stop a bot worker!");
        };
    }
}
