# @bitbasti/chat-adapter-webex

[![npm version](https://img.shields.io/npm/v/@bitbasti/chat-adapter-webex)](https://www.npmjs.com/package/@bitbasti/chat-adapter-webex)
[![npm downloads](https://img.shields.io/npm/dm/@bitbasti/chat-adapter-webex)](https://www.npmjs.com/package/@bitbasti/chat-adapter-webex)
[![CI](https://github.com/SebastianBodza/chat-adapter-webex/actions/workflows/ci.yml/badge.svg)](https://github.com/SebastianBodza/chat-adapter-webex/actions/workflows/ci.yml)

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

bot.onNewMention(async (thread, message) => {
  await thread.post(`Hello from Webex! You said: ${message.text}`);
});
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBEX_BOT_TOKEN` | Yes | Bot access token from the Webex Developer Portal |
| `WEBEX_WEBHOOK_SECRET` | Recommended | Shared secret for webhook signature verification |
| `WEBEX_BASE_URL` | No | Override the Webex API base URL (default: `https://webexapis.com/v1`) |
| `WEBEX_BOT_USERNAME` | No | Override the bot display name |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `botToken` | `string` | `WEBEX_BOT_TOKEN` | Bot access token |
| `webhookSecret` | `string` | `WEBEX_WEBHOOK_SECRET` | Shared secret for verifying webhook signatures |
| `baseUrl` | `string` | `"https://webexapis.com/v1"` | Webex API base URL |
| `userName` | `string` | `"webex-bot"` | Bot display name (overridden by the bot's Webex profile on initialization) |
| `botUserId` | `string` | Auto-detected via `/people/me` | Webex person ID of the bot (skips the `/people/me` call if provided) |
| `logger` | `Logger` | `ConsoleLogger` | Custom logger instance |

## Platform setup

1. Go to the [Webex Developer Portal](https://developer.webex.com/) and sign in.
2. Navigate to **My Webex Apps** → **Create a New App** → **Create a Bot**.
3. Fill in the bot name, username, and icon, then click **Add Bot**.
4. Copy the **Bot Access Token** — this is your `WEBEX_BOT_TOKEN`. Store it securely; it is only shown once.
5. Create a webhook pointing to your server:
   - **Target URL:** `https://your-domain.com/api/webhooks/webex`
   - **Resource:** `messages` | **Event:** `created`
   - **Resource:** `attachmentActions` | **Event:** `created`
   - **Secret:** a random string — this is your `WEBEX_WEBHOOK_SECRET`
6. Add the bot to a Webex space and mention it to verify the integration.

> See the [Webex Webhooks Guide](https://developer.webex.com/messaging/docs/api/guides/webhooks) for details on webhook registration.

## Features

- Mentions and DMs
- Rich text (bold, italic, code, links) via Markdown
- Adaptive Cards (buttons, selects, radio selects, fields, sections)
- Modals (form cards with submit/close actions)
- File uploads (single file per message)
- Thread support (parentId-based threading)
- Webhook signature verification (HMAC-SHA1)

### Limitations

- Reactions are not supported by Webex bot tokens — `addReaction` / `removeReaction` throw `NotImplementedError`
- Typing indicators are not available in the Webex Messaging API
- Only one file upload per message is supported
- Cards and file uploads cannot be combined in the same message

## Development

```bash
npm ci
npm run ci              # lint, typecheck, tests with coverage, build, publint
npm run test:unit       # fast unit tests in src/
npm run test:integration
scripts/consumer-compat.sh minimum   # packed package + chat@<peer minimum>, npm resolves the rest
scripts/consumer-compat.sh latest    # same against the newest chat on npm
```

Integration tests in `test/integration/` run the real `Chat` runtime and adapter
against a stateful in-memory fake of the Webex REST API (`fake-webex-api.ts`),
installed as the global `fetch`. Webhooks are signed exactly like Webex signs
them, so the tests cover signature checks, message hydration, threading, DMs,
cards, modals, file uploads, pagination and error mapping without network access.

`consumer-compat.sh` installs the packed tarball into an empty project like a
user would and runs the same integration suite against the built package. The
`Compat` workflow runs it weekly, on dependency changes and on demand, and opens
an issue when a scheduled run fails, so new `chat` releases are noticed early
without making unrelated PRs fail.

## License

MIT
