# <h1 align="center">grammY runner</h1>

---

While the core of [grammY](https://github.com/grammyjs/grammY) is extremely efficient, the package does not ship with a built-in mechanism for long polling at scale.
(It does scale well with webhooks, though.)
The grammY runner solves this by providing you with a sophisticated mechanism that can pull updates concurrently from the Telegram servers, and in turn execute your bot's middleware stack concurrently, all while catching errors, timeouts, and giving you full control over how much load is applied to your server.

## Do I Need This?

Use the grammY runner package if

- your bot needs to process a lot of updates (more than 1K/hour), or
- your bot performs long-running operations such as large file transfers.

Do **not** use grammY runner if

- you are just getting started with grammY, or
- your bot is running on webhooks.

## Quickstart

```bash
npm i @grammyjs/runner
```

Import `run` from `@grammyjs/runner`, and replace `bot.start()` with `run(bot)`. It is that simple. Done!

---

Okay okay, here is some example code:

```ts
import { Bot } from "grammy";
import { run } from "@grammyjs/runner";

// Create bot
const bot = new Bot("<token>");

// Add the usual middleware, yada yada
bot.on("message", (ctx) => ctx.reply("Got your message."));

// Run it concurrently!
run(bot);
```

## Concurrency is Hard

> A lot of bots should be fine with just following the quickstart above.
> However, concurrency is hard and you should read this section closely if you don't want to experience data loss or other bad things.

When using grammY's built-in `bot.start()`, updates are processed in sequence.
Never are two updates processed concurrently.
This makes everything nice and tidy and your code is very predictable.

As soon as you enter the world of concurrency, several updates can be processed simultaneously.
If a user sends two messages to your bot in the same instant, you cannot assume that the first message will be done processing before the second one starts to be processed.

The main point where this can clash is when you use [sessions](/plugins/session.html), which may run into a write-after-read hazard.
Imagine this sequence of events:

1. Alice sends message A
2. Bot begins processing A
3. Bot reads session data for Alice from database
4. Alice sends message B
5. Bot begins processing B
6. Bot reads session data for Alice from database
7. Bot is done processsing A, and writes new session to database
8. Bot is done processing B, and writes new session to database, hence overwriting the changes performed during processing A.
   Data loss due to WAR hazard!

> Note: You could try use database transactions for your sessions, but then you can only detect the hazard and not prevent it.
> Trying to use a lock instead would effectively eliminate all concurrency.
> It is much easier to avoid the hazard in the first place.

Most other session systems of web frameworks simply accept the risk of race conditions, as they do not happen too frequently on the web.
However, we do not want this because Telegram bots are much more likely to experience clashes of parallel requests for the same session key.
Hence, we have to make sure that updates that access the same session data are processed in sequence in order to avoid this dangerous race condition.

grammY runner ships with `sequentialize()` middleware which makes sure that updates that clash are processed in sequence.
You can configure it with the very same function that you use to determine the session key.
It will then avoid the above race condition by slowing down those (and only those) updates that would cause a collision.

```ts
import { Bot, Context, session, SessionFlavor } from "grammy";
import { run, sequentialize } from "@grammyjs/runner";

// Define session data
interface SessionData {
    counter: 0;
}

// Create bot
type MyContext = Context & SessionFlavor<SessionData>;
const bot = new Bot<MyContext>("<token>");

/** Resolves the session key for a context object */
function getSessionKey(ctx: MyContext) {
    return ctx.chat?.id.toString();
}
/** Creates an initial session data object */
function initial(): SessionData {
    return { counter: 0 };
}

// Sequentialize before accessing session data!
bot.use(sequentialize(getSessionKey));
bot.use(session({ getSessionKey, initial }));

// Add the usual middleware, now with safe session support
bot.on("message", (ctx) => ctx.reply("Got your message."));

// Still run it concurrently!
run(bot);
```

Feel free to join the [Telegram chat](https://t.me/grammjs) to discuss how to use grammY runner with your bot.
We are always happy to hear from people who maintain large bots so we can improve grammY based on their experience with the package.

## Resources

### [grammY runner in the grammY documentation](https://grammy.dev/plugins/runner.html)

—more verbose documentation about concurrency in grammY.

### [grammY runner API Reference](https://doc.deno.land/https/deno.land/x/grammy_runner/mod.ts)

—documentation of everything that grammY runner exports.

### [grammY Example Bots](https://github.com/grammyjs/examples)

—repository full of example bots, look our for those that demonstrate how to use grammY runner.
