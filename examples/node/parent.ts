import { Bot } from "grammy";
import { distribute, run } from "../..";

// Create bot
const bot = new Bot("");

// Add the usual middleware, yada yada
bot.command("start", (ctx) => ctx.reply("Got your message."));
bot.use(distribute("./sub.ts"));

// Run it concurrently!
run(bot);
