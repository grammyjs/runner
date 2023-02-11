import { BotWorker } from "../../out/mod";

const bot = new BotWorker("");

bot.on("message", (ctx) => ctx.reply("yay!"));
