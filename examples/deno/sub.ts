import { BotWorker } from "../../src/mod.ts";

const bot = new BotWorker("829364035:AAEZe8w3l_1clIVkK-42nv7_JBF4-JKqO4I");

bot.on("message", (ctx) => ctx.reply("yay!"));
