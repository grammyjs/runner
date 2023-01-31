import {
    type Api,
    Bot,
    type BotConfig,
    type Context,
    type Update,
} from "./deps.deno.ts";

export class BotWorker<
    C extends Context = Context,
    A extends Api = Api,
> extends Bot<C, A> {
    constructor(
        public readonly token: string,
        config?: BotConfig<C>,
    ) {
        super(token, config);
        self.onmessage = async ({ data: update }: MessageEvent<Update>) => {
            if (!this.isInited()) await this.init();
            await this.handleUpdate(update);
            self.postMessage(update.update_id);
        };
        this.start = () => {
            throw new Error("Cannot start a bot worker!");
        };
        this.stop = () => {
            throw new Error("Cannot stop a bot worker!");
        };
    }
}