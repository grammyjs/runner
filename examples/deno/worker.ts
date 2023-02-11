import { BotWorker } from "../../src/mod.ts";

const bot = new BotWorker("");

bot.on("message", (ctx) => ctx.reply("yay!"));
