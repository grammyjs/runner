import { BotWorker } from "../..";

const bot = new BotWorker("");

bot.on("message", (ctx) => ctx.reply("yay!"));
