# @bitbasti/chat-adapter-webex

[![npm version](https://img.shields.io/npm/v/@bitbasti/chat-adapter-webex)](https://www.npmjs.com/package/@bitbasti/chat-adapter-webex)
[![npm downloads](https://img.shields.io/npm/dm/@bitbasti/chat-adapter-webex)](https://www.npmjs.com/package/@bitbasti/chat-adapter-webex)

Community Webex adapter for [Chat SDK](https://chat-sdk.dev/docs).

## Installation

```bash
npm install chat @bitbasti/chat-adapter-webex
```

## Usage

```ts
import { Chat } from "chat";
import { createWebexAdapter } from "@bitbasti/chat-adapter-webex";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    webex: createWebexAdapter({
      botToken: process.env.WEBEX_BOT_TOKEN!,
      webhookSecret: process.env.WEBEX_WEBHOOK_SECRET,
    }),
  },
});

bot.onNewMention(async (thread) => {
  await thread.post("Hello from Webex!");
});
```

## Environment variables

- `WEBEX_BOT_TOKEN` (required)
- `WEBEX_WEBHOOK_SECRET` (recommended for webhook signature verification)
- `WEBEX_BASE_URL` (optional; defaults to `https://webexapis.com/v1`)
- `WEBEX_BOT_USERNAME` (optional)

## License

MIT
