import { Bot } from "grammy";
import { distribute, run } from "../..";

// Create bot
const bot = new Bot("829364035:AAEZe8w3l_1clIVkK-42nv7_JBF4-JKqO4I");

// Add the usual middleware, yada yada
bot.command("start", (ctx) => ctx.reply("Got your message."));
bot.use(distribute("./sub.ts"));

// Run it concurrently!
run(bot);
