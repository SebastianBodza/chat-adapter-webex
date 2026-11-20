import { Chat, type Logger, type StateAdapter } from "chat";
import { vi } from "vitest";
import { createWebexAdapter, type WebexAdapter, type WebexAdapterConfig } from "../../src/index";
import type { WebexAttachmentAction, WebexPerson } from "../../src/types";
import {
  createInMemoryStateAdapter,
  createSparkSignature,
  createWaitUntilTracker,
} from "../../src/test-utils";
import { FakeWebexApi, type StoredMessage } from "./fake-webex-api";

export const BOT_TOKEN = "integration-bot-token";
export const WEBHOOK_SECRET = "integration-webhook-secret";

export const BOT: WebexPerson = {
  id: "bot-person-id",
  displayName: "Helper Bot",
  nickName: "helper",
  emails: ["helper@webex.bot"],
  type: "bot",
};

export const ALICE: WebexPerson = {
  id: "person-alice",
  displayName: "Alice Example",
  emails: ["alice@example.com"],
  type: "person",
};

export const BOB: WebexPerson = {
  id: "person-bob",
  displayName: "Bob Example",
  emails: ["bob@example.com"],
  type: "person",
};

export interface RecordingLogger extends Logger {
  entries: Array<{ level: "debug" | "info" | "warn" | "error"; message: string; meta?: unknown }>;
}

export function createRecordingLogger(): RecordingLogger {
  const entries: RecordingLogger["entries"] = [];
  const logger: RecordingLogger = {
    entries,
    debug: (message, meta) => entries.push({ level: "debug", message, meta }),
    info: (message, meta) => entries.push({ level: "info", message, meta }),
    warn: (message, meta) => entries.push({ level: "warn", message, meta }),
    error: (message, meta) => entries.push({ level: "error", message, meta }),
    child: () => logger,
  };
  return logger;
}

export interface HarnessOptions {
  adapter?: Partial<Omit<WebexAdapterConfig, "logger">>;
  enforceGroupMentionFilter?: boolean;
  /** Skip passing `botUserId` so the adapter resolves it via `/people/me`. */
  discoverBotIdentity?: boolean;
  state?: StateAdapter;
}

export type Harness = ReturnType<typeof createHarness>;

/**
 * Builds a full stack: fake Webex REST API (as global fetch) → WebexAdapter →
 * real Chat instance with in-memory state. Webhooks are signed exactly like
 * Webex does it and processed to completion before `deliver*` resolves.
 */
export function createHarness(options: HarnessOptions = {}) {
  const api = new FakeWebexApi({
    bot: BOT,
    token: BOT_TOKEN,
    enforceGroupMentionFilter: options.enforceGroupMentionFilter,
  });
  api.addPerson(ALICE);
  api.addPerson(BOB);
  vi.stubGlobal("fetch", api.fetch);

  const logger = createRecordingLogger();
  const adapter: WebexAdapter = createWebexAdapter({
    botToken: BOT_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    userName: "helper",
    botUserId: options.discoverBotIdentity ? undefined : BOT.id,
    logger,
    ...options.adapter,
  });

  const state = options.state ?? createInMemoryStateAdapter();
  const chat = new Chat({
    userName: "helper",
    adapters: { webex: adapter },
    state,
    logger: "silent",
  });

  const tracker = createWaitUntilTracker();

  const sendRawWebhook = async (
    body: string,
    headers: Record<string, string> = {}
  ): Promise<Response> => {
    const response = await chat.webhooks.webex(
      new Request("https://bot.example.com/api/webhooks/webex", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      }),
      { waitUntil: tracker.waitUntil }
    );
    await tracker.waitForAll();
    return response;
  };

  // Sign with whatever secret the adapter was configured with (unsigned if none).
  const configuredSecret =
    options.adapter && "webhookSecret" in options.adapter
      ? (options.adapter.webhookSecret ?? null)
      : WEBHOOK_SECRET;

  const sendWebhook = async (
    payload: unknown,
    signWith: string | null = configuredSecret
  ): Promise<Response> => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {};
    if (signWith !== null) {
      headers["x-spark-signature"] = createSparkSignature(body, signWith);
    }
    return sendRawWebhook(body, headers);
  };

  /** Stores a user message in the fake API and delivers its `messages:created` webhook. */
  const deliverMessage = async (
    message: Partial<StoredMessage> & { roomId: string }
  ): Promise<{ message: StoredMessage; response: Response }> => {
    const stored = api.addMessage(message);
    const response = await sendWebhook({
      id: "webhook-messages",
      resource: "messages",
      event: "created",
      actorId: stored.personId,
      data: {
        id: stored.id,
        roomId: stored.roomId,
        personId: stored.personId,
        personEmail: stored.personEmail,
        created: stored.created,
      },
    });
    return { message: stored, response };
  };

  /** Stores an attachment action (card submit) and delivers its webhook. */
  const deliverAction = async (
    action: Omit<WebexAttachmentAction, "id"> & { id?: string }
  ): Promise<{ action: WebexAttachmentAction; response: Response }> => {
    const stored = api.addAttachmentAction(action);
    const person = stored.personId ? api.people.get(stored.personId) : undefined;
    const response = await sendWebhook({
      id: "webhook-actions",
      resource: "attachmentActions",
      event: "created",
      actorId: stored.personId,
      data: {
        id: stored.id,
        messageId: stored.messageId,
        personId: stored.personId,
        personEmail: person?.emails?.[0],
      },
    });
    return { action: stored, response };
  };

  return {
    adapter,
    api,
    chat,
    /** Initialises Chat + adapter, as happens implicitly on the first webhook. */
    init: () => chat.initialize(),
    deliverAction,
    deliverMessage,
    logger,
    sendRawWebhook,
    sendWebhook,
    state,
  };
}

/** Thread ID the adapter derives for a group-space message rooted at `rootMessageId`. */
export function groupThreadId(harness: Harness, roomId: string, rootMessageId: string): string {
  return harness.adapter.encodeThreadId({ roomId, rootMessageId });
}

/** Finds the Adaptive Card payload of a stored message. */
export function adaptiveCardOf(message: StoredMessage | undefined): Record<string, unknown> {
  const attachment = message?.attachments?.find(
    (candidate) => candidate.contentType === "application/vnd.microsoft.card.adaptive"
  );
  if (!attachment) {
    throw new Error(`Message ${message?.id ?? "<none>"} has no adaptive card attachment`);
  }
  return attachment.content as Record<string, unknown>;
}

/** Returns the `data` of the Action.Submit with the given title on a card. */
export function submitDataOf(card: Record<string, unknown>, title: string): Record<string, string> {
  const actions = (card.actions ?? []) as Array<{ data?: Record<string, string>; title?: string; type?: string }>;
  const action = actions.find((candidate) => candidate.title === title);
  if (!action?.data) {
    throw new Error(`Card has no Action.Submit titled "${title}"`);
  }
  return action.data;
}
