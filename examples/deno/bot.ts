import { Bot } from "https://deno.land/x/grammy@v1.13.1/mod.ts";
import { distribute, run } from "../../src/mod.ts";

// Create bot
const bot = new Bot("");

// Add the usual middleware, yada yada
bot.command("start", (ctx) => ctx.reply("Got your message."));
bot.use(distribute(new URL("./sub.ts", import.meta.url)));

// Run it concurrently!
run(bot);
