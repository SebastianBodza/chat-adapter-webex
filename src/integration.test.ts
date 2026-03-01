import type {
  ActionEvent,
  Logger,
  Message,
  Thread,
} from "chat";
import { Chat } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebexAdapter, type WebexAttachmentAction, type WebexMessage } from "./index";
import {
  createInMemoryStateAdapter,
  createSignedWebhookRequest,
  createWaitUntilTracker,
  jsonResponse,
} from "./test-utils";

const WEBHOOK_SECRET = "integration-secret";

const testLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};

interface FetchFixtures {
  actions?: Record<string, WebexAttachmentAction>;
  messages?: Record<string, WebexMessage>;
  people?: Record<
    string,
    {
      displayName?: string;
      emails?: string[];
      id: string;
      type?: "bot" | "person";
    }
  >;
}

interface IntegrationHandlers {
  onAction?: (event: ActionEvent) => void | Promise<void>;
  onMention?: (thread: Thread, message: Message) => void | Promise<void>;
  onSubscribed?: (thread: Thread, message: Message) => void | Promise<void>;
}

interface CapturedEvents {
  actionEvent: ActionEvent | null;
  mentionMessage: Message | null;
  mentionThread: Thread | null;
  subscribedMessage: Message | null;
  subscribedThread: Thread | null;
}

function parseJsonBody(body: RequestInit["body"]): Record<string, unknown> {
  if (typeof body !== "string") {
    return {};
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function getResourceId(url: string, marker: string): string {
  const start = url.indexOf(marker);
  if (start === -1) {
    return "";
  }

  const raw = url.slice(start + marker.length).split("?")[0];
  return decodeURIComponent(raw || "");
}

function createWebexFetchMock(fixtures: FetchFixtures): {
  postedMessages: Array<Record<string, unknown>>;
} {
  const postedMessages: Array<Record<string, unknown>> = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();

    if (method === "GET" && url.includes("/messages/")) {
      const messageId = getResourceId(url, "/messages/");
      const message = fixtures.messages?.[messageId];
      if (!message) {
        return jsonResponse({ message: "Not found" }, 404);
      }
      return jsonResponse(message);
    }

    if (method === "POST" && url.endsWith("/messages")) {
      const payload = parseJsonBody(init?.body);
      postedMessages.push(payload);
      const roomId =
        typeof payload.roomId === "string"
          ? payload.roomId
          : typeof payload.toPersonId === "string"
            ? `dm-room-${payload.toPersonId}`
            : "room-posted";
      return jsonResponse({
        id: `out-${postedMessages.length}`,
        roomId,
      });
    }

    if (method === "DELETE" && url.includes("/messages/")) {
      return new Response(null, { status: 204 });
    }

    if (method === "GET" && url.includes("/attachment/actions/")) {
      const actionId = getResourceId(url, "/attachment/actions/");
      const action = fixtures.actions?.[actionId];
      if (!action) {
        return jsonResponse({ message: "Not found" }, 404);
      }
      return jsonResponse(action);
    }

    if (method === "GET" && url.includes("/people/")) {
      const personId = getResourceId(url, "/people/");
      const person = fixtures.people?.[personId];
      if (!person) {
        return jsonResponse({ message: "Not found" }, 404);
      }
      return jsonResponse(person);
    }

    throw new Error(`Unhandled fetch request: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { postedMessages };
}

function createWebexIntegrationContext(handlers: IntegrationHandlers = {}) {
  const adapter = createWebexAdapter({
    botToken: "token",
    botUserId: "bot-person-id",
    userName: "bot",
    webhookSecret: WEBHOOK_SECRET,
    logger: testLogger,
  });

  const chat = new Chat({
    userName: "bot",
    adapters: { webex: adapter },
    state: createInMemoryStateAdapter(),
    logger: "silent",
  });

  const captured: CapturedEvents = {
    actionEvent: null,
    mentionMessage: null,
    mentionThread: null,
    subscribedMessage: null,
    subscribedThread: null,
  };

  chat.onNewMention(async (thread, message) => {
    captured.mentionThread = thread;
    captured.mentionMessage = message;
    if (handlers.onMention) {
      await handlers.onMention(thread, message);
    }
  });

  chat.onSubscribedMessage(async (thread, message) => {
    captured.subscribedThread = thread;
    captured.subscribedMessage = message;
    if (handlers.onSubscribed) {
      await handlers.onSubscribed(thread, message);
    }
  });

  chat.onAction(async (event) => {
    captured.actionEvent = event;
    if (handlers.onAction) {
      await handlers.onAction(event);
    }
  });

  const tracker = createWaitUntilTracker();

  return {
    captured,
    chat,
    sendWebhook: async (payload: unknown) => {
      const response = await chat.webhooks.webex(
        createSignedWebhookRequest(payload, WEBHOOK_SECRET),
        { waitUntil: tracker.waitUntil }
      );
      await tracker.waitForAll();
      return response;
    },
  };
}

describe("Webex adapter integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("handles mention -> subscribe -> follow-up flow through Chat handlers", async () => {
    const fetchHarness = createWebexFetchMock({
      messages: {
        "msg-mention": {
          id: "msg-mention",
          roomId: "room-1",
          personId: "user-1",
          personEmail: "user1@example.com",
          roomType: "group",
          mentionedPeople: ["bot-person-id"],
          text: "@bot hello",
          created: "2026-02-24T20:00:00.000Z",
        },
        "msg-follow-up": {
          id: "msg-follow-up",
          roomId: "room-1",
          parentId: "msg-mention",
          personId: "user-1",
          personEmail: "user1@example.com",
          roomType: "group",
          text: "follow up",
          created: "2026-02-24T20:01:00.000Z",
        },
      },
    });

    const ctx = createWebexIntegrationContext({
      onMention: async (thread) => {
        await thread.subscribe();
        await thread.post("Got it!");
      },
      onSubscribed: async (thread, message) => {
        await thread.post(`Echo: ${message.text}`);
      },
    });

    const mentionResponse = await ctx.sendWebhook({
      resource: "messages",
      event: "created",
      data: { id: "msg-mention" },
    });

    expect(mentionResponse.status).toBe(200);
    expect(ctx.captured.mentionMessage?.text).toBe("@bot hello");
    expect(ctx.captured.subscribedMessage).toBeNull();

    const followUpResponse = await ctx.sendWebhook({
      resource: "messages",
      event: "created",
      data: { id: "msg-follow-up" },
    });

    expect(followUpResponse.status).toBe(200);
    expect(ctx.captured.subscribedMessage?.text).toBe("follow up");

    expect(fetchHarness.postedMessages).toHaveLength(2);
    expect(fetchHarness.postedMessages[0]).toMatchObject({
      roomId: "room-1",
      parentId: "msg-mention",
      markdown: "Got it!",
    });
    expect(fetchHarness.postedMessages[1]).toMatchObject({
      roomId: "room-1",
      parentId: "msg-mention",
      markdown: "Echo: follow up",
    });
  });

  it("routes attachment actions to onAction with normalized event fields", async () => {
    createWebexFetchMock({
      actions: {
        "action-approve": {
          id: "action-approve",
          messageId: "msg-card-1",
          personId: "user-2",
          type: "submit",
          inputs: {
            actionId: "approve",
            value: "yes",
          },
        },
      },
      messages: {
        "msg-card-1": {
          id: "msg-card-1",
          roomId: "room-2",
          personId: "user-1",
          text: "Please approve",
        },
      },
      people: {
        "user-2": {
          id: "user-2",
          displayName: "User Two",
          emails: ["user2@example.com"],
          type: "person",
        },
      },
    });

    const ctx = createWebexIntegrationContext();

    const response = await ctx.sendWebhook({
      resource: "attachmentActions",
      event: "created",
      data: { id: "action-approve", personEmail: "user2@example.com" },
    });

    expect(response.status).toBe(200);
    expect(ctx.captured.actionEvent).not.toBeNull();
    expect(ctx.captured.actionEvent?.actionId).toBe("approve");
    expect(ctx.captured.actionEvent?.value).toBe("yes");
    expect(ctx.captured.actionEvent?.messageId).toBe("msg-card-1");
    expect(ctx.captured.actionEvent?.thread.id).toBe(
      ctx.captured.actionEvent?.threadId
    );
    expect(ctx.captured.actionEvent?.user).toMatchObject({
      userId: "user-2",
      userName: "user2",
      fullName: "User Two",
      isBot: false,
    });
  });

  it("filters out bot-authored webhooks before mention handlers run", async () => {
    createWebexFetchMock({
      messages: {
        "msg-self": {
          id: "msg-self",
          roomId: "room-3",
          personId: "bot-person-id",
          personEmail: "bot@example.com",
          roomType: "group",
          mentionedPeople: ["bot-person-id"],
          text: "@bot ignore this",
        },
      },
    });

    const ctx = createWebexIntegrationContext();

    const response = await ctx.sendWebhook({
      resource: "messages",
      event: "created",
      data: { id: "msg-self" },
    });

    expect(response.status).toBe(200);
    expect(ctx.captured.mentionMessage).toBeNull();
    expect(ctx.captured.subscribedMessage).toBeNull();
  });

  it("routes direct-message webhooks as mention events with DM threads", async () => {
    createWebexFetchMock({
      messages: {
        "msg-dm": {
          id: "msg-dm",
          roomId: "room-dm-1",
          roomType: "direct",
          personId: "user-dm",
          personEmail: "dm@example.com",
          text: "hello in dm",
          created: "2026-02-24T20:02:00.000Z",
        },
      },
    });

    const ctx = createWebexIntegrationContext();

    const response = await ctx.sendWebhook({
      resource: "messages",
      event: "created",
      data: { id: "msg-dm" },
    });

    expect(response.status).toBe(200);
    expect(ctx.captured.mentionMessage).not.toBeNull();
    expect(ctx.captured.mentionMessage?.isMention).toBe(true);
    expect(ctx.captured.mentionThread?.isDM).toBe(true);
  });

  it("keeps direct-message follow-ups in one subscribed thread", async () => {
    createWebexFetchMock({
      messages: {
        "msg-dm-1": {
          id: "msg-dm-1",
          roomId: "room-dm-2",
          roomType: "direct",
          personId: "user-dm",
          personEmail: "dm@example.com",
          text: "first dm",
          created: "2026-02-24T20:03:00.000Z",
        },
        "msg-dm-2": {
          id: "msg-dm-2",
          roomId: "room-dm-2",
          roomType: "direct",
          personId: "user-dm",
          personEmail: "dm@example.com",
          text: "second dm",
          created: "2026-02-24T20:04:00.000Z",
        },
      },
    });

    const ctx = createWebexIntegrationContext({
      onMention: async (thread) => {
        await thread.subscribe();
      },
    });

    await ctx.sendWebhook({
      resource: "messages",
      event: "created",
      data: { id: "msg-dm-1" },
    });
    expect(ctx.captured.mentionThread).not.toBeNull();

    await ctx.sendWebhook({
      resource: "messages",
      event: "created",
      data: { id: "msg-dm-2" },
    });

    expect(ctx.captured.subscribedMessage?.text).toBe("second dm");
    expect(ctx.captured.subscribedThread?.id).toBe(ctx.captured.mentionThread?.id);
  });

});
