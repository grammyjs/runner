import {
    type Api,
    Bot,
    type BotConfig,
    type Context,
    type Update,
} from "./deps.deno.ts";
import { parentThread } from "./platform.deno.ts";

export class BotWorker<
    C extends Context = Context,
    A extends Api = Api,
> extends Bot<C, A> {
    constructor(
        public readonly token: string,
        config?: BotConfig<C>,
    ) {
        super(token, config);
        const p = parentThread<number, Update>();
        p.onMessage(async (update: Update) => {
            if (!this.isInited()) await this.init();
            await this.handleUpdate(update);
            p.postMessage(update.update_id);
        });
        this.start = () => {
            throw new Error("Cannot start a bot worker!");
        };
        this.stop = () => {
            throw new Error("Cannot stop a bot worker!");
        };
    }
}
