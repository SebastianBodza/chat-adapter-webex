import { createHmac } from "node:crypto";
import type { ChatInstance, Lock, Logger, StateAdapter } from "chat";
import {
  Actions,
  Card,
  Modal,
  RadioSelect,
  Select,
  SelectOption,
  TextInput,
} from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebexAdapter, WebexAdapter } from "./index";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
};

function createMockState(): StateAdapter & { cache: Map<string, unknown> } {
  const cache = new Map<string, unknown>();
  return {
    cache,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    isSubscribed: vi.fn().mockResolvedValue(false),
    acquireLock: vi
      .fn()
      .mockResolvedValue({ threadId: "", token: "", expiresAt: 0 } as Lock),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    extendLock: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(cache.get(key) ?? null);
    }),
    set: vi.fn().mockImplementation((key: string, value: unknown) => {
      cache.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => {
      cache.delete(key);
      return Promise.resolve();
    }),
  };
}

function createMockChat(state: StateAdapter): ChatInstance {
  return {
    getState: () => state,
    getLogger: () => mockLogger,
    processMessage: vi.fn(),
    processAction: vi.fn(),
    processModalSubmit: vi.fn().mockResolvedValue(undefined),
    processModalClose: vi.fn(),
  } as unknown as ChatInstance;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createSparkSignature(body: string, secret: string): string {
  return createHmac("sha1", secret).update(body).digest("hex");
}

function createWebhookRequest(body: string, secret: string): Request {
  return new Request("https://example.com/webhooks/webex", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spark-signature": createSparkSignature(body, secret),
    },
    body,
  });
}

function createWaitUntilTracker() {
  const tasks: Promise<unknown>[] = [];
  return {
    waitUntil: (task: Promise<unknown>) => {
      tasks.push(task);
    },
    waitForAll: async () => {
      await Promise.allSettled(tasks);
    },
  };
}

describe("createWebexAdapter", () => {
  const originalToken = process.env.WEBEX_BOT_TOKEN;
  const originalSecret = process.env.WEBEX_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.WEBEX_BOT_TOKEN;
    } else {
      process.env.WEBEX_BOT_TOKEN = originalToken;
    }
    if (originalSecret === undefined) {
      delete process.env.WEBEX_WEBHOOK_SECRET;
    } else {
      process.env.WEBEX_WEBHOOK_SECRET = originalSecret;
    }
  });

  it("creates adapter with explicit token", () => {
    const adapter = createWebexAdapter({
      botToken: "test-token",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(WebexAdapter);
    expect(adapter.name).toBe("webex");
  });

  it("throws when token is missing", () => {
    delete process.env.WEBEX_BOT_TOKEN;
    expect(() => createWebexAdapter({ logger: mockLogger })).toThrow(
      "botToken is required"
    );
  });

  it("falls back to WEBEX_BOT_TOKEN env var", () => {
    process.env.WEBEX_BOT_TOKEN = "env-token";
    const adapter = createWebexAdapter({ logger: mockLogger });
    expect(adapter).toBeInstanceOf(WebexAdapter);
    expect(adapter.name).toBe("webex");
  });
});

describe("thread ID encoding", () => {
  const adapter = createWebexAdapter({
    botToken: "token",
    logger: mockLogger,
  });

  it("encodes and decodes thread IDs", () => {
    const encoded = adapter.encodeThreadId({
      roomId: "Y2lzY29zcGFyazovL3VzL1JPT00vabc",
      rootMessageId: "Y2lzY29zcGFyazovL3VzL01FU1NBR0Uv123",
    });
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual({
      roomId: "Y2lzY29zcGFyazovL3VzL1JPT00vabc",
      rootMessageId: "Y2lzY29zcGFyazovL3VzL01FU1NBR0Uv123",
    });
    expect(adapter.channelIdFromThreadId(encoded)).toMatch(/^webex:/);
  });

  it("throws on invalid thread IDs", () => {
    expect(() => adapter.decodeThreadId("webex:abc")).toThrow(
      "Invalid Webex thread ID"
    );
  });
});

describe("handleWebhook", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects invalid signatures", async () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    await adapter.initialize(createMockChat(state));

    const request = new Request("https://example.com/webhooks/webex", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-spark-signature": "invalid",
      },
      body: JSON.stringify({ resource: "messages", event: "created" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("processes messages.created webhooks", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-1",
        roomId: "room-1",
        personId: "user-1",
        personEmail: "user@example.com",
        text: "Hello @bot",
        created: "2026-02-24T20:00:00.000Z",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      userName: "bot",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);
    const tracker = createWaitUntilTracker();

    const body = JSON.stringify({
      resource: "messages",
      event: "created",
      data: { id: "msg-1" },
    });
    const response = await adapter.handleWebhook(createWebhookRequest(body, "secret"), {
      waitUntil: tracker.waitUntil,
    });

    expect(response.status).toBe(200);
    await tracker.waitForAll();
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const call = (chat.processMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(adapter);
    expect(call[1]).toBe(
      adapter.encodeThreadId({
        roomId: "room-1",
        rootMessageId: "msg-1",
      })
    );
  });

  it("processes attachmentActions.created webhooks", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "action-1",
        type: "submit",
        messageId: "msg-1",
        personId: "user-2",
        inputs: { actionId: "approve", value: "ok" },
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-1",
        roomId: "room-1",
        personId: "user-1",
        text: "Card",
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "user-2",
        displayName: "User Two",
        emails: ["user2@example.com"],
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);
    const tracker = createWaitUntilTracker();

    const body = JSON.stringify({
      resource: "attachmentActions",
      event: "created",
      data: { id: "action-1" },
    });
    const response = await adapter.handleWebhook(createWebhookRequest(body, "secret"), {
      waitUntil: tracker.waitUntil,
    });

    expect(response.status).toBe(200);
    await tracker.waitForAll();
    expect(chat.processAction).toHaveBeenCalledTimes(1);
    const actionEvent = (chat.processAction as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(actionEvent.actionId).toBe("approve");
    expect(actionEvent.value).toBe("ok");
  });

  it("extracts selected value from inputs[actionId] for choice submit actions", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "action-2",
        type: "submit",
        messageId: "msg-2",
        personId: "user-2",
        inputs: {
          actionId: "quick_action",
          quick_action: "greet",
          source: "select",
        },
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-2",
        roomId: "room-2",
        personId: "user-1",
        text: "Card",
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "user-2",
        displayName: "User Two",
        emails: ["user2@example.com"],
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);
    const tracker = createWaitUntilTracker();

    const body = JSON.stringify({
      resource: "attachmentActions",
      event: "created",
      data: { id: "action-2" },
    });
    const response = await adapter.handleWebhook(createWebhookRequest(body, "secret"), {
      waitUntil: tracker.waitUntil,
    });

    expect(response.status).toBe(200);
    await tracker.waitForAll();
    expect(chat.processAction).toHaveBeenCalledTimes(1);
    const actionEvent = (chat.processAction as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(actionEvent.actionId).toBe("quick_action");
    expect(actionEvent.value).toBe("greet");
  });

  it("routes modal submit attachment actions to processModalSubmit", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "action-modal-1",
        type: "submit",
        messageId: "msg-modal-1",
        personId: "user-2",
        inputs: {
          actionId: "__chat_modal_submit:view-1",
          _chat_modal: "1",
          _chat_modal_action: "submit",
          _chat_modal_view_id: "view-1",
          _chat_modal_callback_id: "feedback_form",
          _chat_modal_context_id: "ctx-1",
          feedback: "Looks great",
          category: "feature",
        },
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-modal-1",
        roomId: "room-modal-1",
        personId: "user-1",
        text: "Modal card",
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "user-2",
        displayName: "User Two",
        emails: ["user2@example.com"],
      })
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);
    const tracker = createWaitUntilTracker();

    const body = JSON.stringify({
      resource: "attachmentActions",
      event: "created",
      data: { id: "action-modal-1" },
    });
    const response = await adapter.handleWebhook(createWebhookRequest(body, "secret"), {
      waitUntil: tracker.waitUntil,
    });

    expect(response.status).toBe(200);
    await tracker.waitForAll();
    expect(chat.processAction).not.toHaveBeenCalled();
    expect(chat.processModalSubmit).toHaveBeenCalledTimes(1);
    const submitEvent = (chat.processModalSubmit as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(submitEvent.callbackId).toBe("feedback_form");
    expect(submitEvent.values).toEqual({
      feedback: "Looks great",
      category: "feature",
    });
    const deleteCall = fetchMock.mock.calls[3];
    expect(String(deleteCall[0])).toContain("/messages/msg-modal-1");
    expect((deleteCall[1] as RequestInit).method).toBe("DELETE");
  });

  it("acks immediately and defers message processing", async () => {
    let resolveMessageFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveMessageFetch = resolve;
        })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      userName: "bot",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);
    const tracker = createWaitUntilTracker();

    const body = JSON.stringify({
      resource: "messages",
      event: "created",
      data: { id: "msg-ack" },
    });

    const response = await adapter.handleWebhook(createWebhookRequest(body, "secret"), {
      waitUntil: tracker.waitUntil,
    });

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();

    resolveMessageFetch?.(
      jsonResponse({
        id: "msg-ack",
        roomId: "room-ack",
        personId: "user-ack",
        personEmail: "ack@example.com",
        text: "hello",
        created: "2026-02-24T20:00:00.000Z",
      })
    );

    await tracker.waitForAll();
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
  });
});

describe("api operations", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts card messages with adaptive card attachment", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "reply-1",
        roomId: "room-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await adapter.postMessage(threadId, {
      card: {
        type: "card",
        title: "Deploy",
        children: [],
      },
      fallbackText: "Deploy",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.roomId).toBe("room-1");
    expect(body.parentId).toBe("root-1");
    expect(body.attachments).toBeTruthy();
  });

  it("converts select and radio controls into adaptive card choices", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "reply-choices",
        roomId: "room-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await adapter.postMessage(
      threadId,
      Card({
        title: "Choices",
        children: [
          Actions([
            Select({
              id: "quick_action",
              label: "Quick Action",
              placeholder: "Choose...",
              options: [
                SelectOption({ label: "Say Hello", value: "greet" }),
                SelectOption({ label: "Show Info", value: "info" }),
              ],
            }),
            RadioSelect({
              id: "plan_selected",
              label: "Choose Plan",
              options: [
                SelectOption({ label: "All text elements", value: "all_text" }),
                SelectOption({
                  label: "Headers only",
                  value: "headers_titles",
                }),
              ],
            }),
          ]),
        ],
      })
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as {
      attachments: Array<{ content: { body: unknown[]; actions: unknown[] } }>;
    };

    const content = body.attachments[0].content;
    const choiceSets = content.body.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as { type?: string }).type === "Input.ChoiceSet"
    ) as Array<{ id: string; style: string }>;

    expect(choiceSets).toHaveLength(2);
    expect(choiceSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "quick_action", style: "compact" }),
        expect.objectContaining({ id: "plan_selected", style: "expanded" }),
      ])
    );

    expect(content.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "Action.Submit",
          data: expect.objectContaining({ actionId: "quick_action" }),
        }),
        expect.objectContaining({
          type: "Action.Submit",
          data: expect.objectContaining({ actionId: "plan_selected" }),
        }),
      ])
    );
  });

  it("fetches thread messages in chronological order", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "reply-1",
            roomId: "room-1",
            parentId: "root-1",
            personId: "user-2",
            text: "Reply",
            created: "2026-02-24T20:02:00.000Z",
          },
          {
            id: "root-1",
            roomId: "room-1",
            personId: "user-1",
            text: "Root",
            created: "2026-02-24T20:00:00.000Z",
          },
        ],
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });
    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    const result = await adapter.fetchMessages(threadId, { limit: 2 });
    expect(result.messages.map((m) => m.id)).toEqual(["root-1", "reply-1"]);
  });

  it("fetches forward history beyond 2000 matched messages", async () => {
    const fetchMock = vi.mocked(fetch);
    let nextId = 2001;

    fetchMock.mockImplementation(async () => {
      if (nextId <= 0) {
        return jsonResponse({ items: [] });
      }

      const batchSize = nextId === 1 ? 1 : 100;
      const items = Array.from({ length: batchSize }, (_, index) => {
        const id = nextId - index;
        return {
          id: `msg-${id}`,
          roomId: "room-1",
          parentId: "root-1",
          personId: "user-1",
          text: `Message ${id}`,
          created: "2026-02-24T20:00:00.000Z",
        };
      });
      nextId -= batchSize;

      return jsonResponse({ items });
    });

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    const result = await adapter.fetchMessages(threadId, {
      direction: "forward",
      limit: 1,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.id).toBe("msg-1");
    expect(fetchMock).toHaveBeenCalledTimes(21);
  });

  it("scans backward history beyond 20 pages for sparse thread replies", async () => {
    const fetchMock = vi.mocked(fetch);
    let page = 0;

    fetchMock.mockImplementation(async () => {
      page += 1;
      if (page > 21) {
        return jsonResponse({ items: [] });
      }

      const items = Array.from({ length: 50 }, (_, index) => ({
        id: `p${page}-m${index}`,
        roomId: "room-1",
        parentId: page === 21 && index === 0 ? "root-1" : "other-root",
        personId: "user-1",
        text: page === 21 && index === 0 ? "Target reply" : "Noise",
        created: "2026-02-24T20:00:00.000Z",
      }));

      return jsonResponse({ items });
    });

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    const result = await adapter.fetchMessages(threadId, { limit: 1 });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.id).toBe("p21-m0");
    expect(fetchMock).toHaveBeenCalledTimes(21);
  });

  it("retries room message listing with mentionedPeople=me after permission error", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: "The request was unauthorized.",
        },
        403
      )
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "root-1",
            roomId: "room-group-1",
            personId: "user-1",
            text: "Mentioned bot message",
            created: "2026-02-24T20:00:00.000Z",
          },
        ],
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-group-1",
      rootMessageId: "root-1",
    });

    const result = await adapter.fetchMessages(threadId, { limit: 1 });
    expect(result.messages).toHaveLength(1);

    const firstUrl = String(fetchMock.mock.calls[0][0]);
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(firstUrl).not.toContain("mentionedPeople=me");
    expect(secondUrl).toContain("mentionedPeople=me");
  });

  it("posts DM messages using toPersonId in pseudo DM threads", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-1",
        roomId: "direct-room-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const dmThreadId = await adapter.openDM("person-123");
    await adapter.postMessage(dmThreadId, "hello");

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.toPersonId).toBe("person-123");
    expect(body.roomId).toBeUndefined();
    expect(body.parentId).toBeUndefined();
  });

  it("rejects sending more than one uploaded file in a single message", async () => {
    const fetchMock = vi.mocked(fetch);

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await expect(
      adapter.postMessage(threadId, {
        markdown: "Files",
        files: [
          {
            filename: "a.txt",
            data: Buffer.from("a"),
            mimeType: "text/plain",
          },
          {
            filename: "b.txt",
            data: Buffer.from("b"),
            mimeType: "text/plain",
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
      adapter: "webex",
      code: "VALIDATION_ERROR",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns Webex-scoped validation errors for unsupported file data", async () => {
    const fetchMock = vi.mocked(fetch);

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await expect(
      adapter.postMessage(threadId, {
        markdown: "Bad file payload",
        files: [
          {
            filename: "bad.txt",
            data: "not-a-buffer" as unknown as Buffer,
            mimeType: "text/plain",
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
      adapter: "webex",
      code: "VALIDATION_ERROR",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens Webex modal by posting an adaptive card form", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "modal-msg-1",
        roomId: "room-modal-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);

    const threadId = adapter.encodeThreadId({
      roomId: "room-modal-1",
      rootMessageId: "root-modal-1",
    });
    state.cache.set("modal-context:webex:ctx-modal-1", {
      thread: { id: threadId },
    });

    const view = await adapter.openModal(
      "trigger-id",
      Modal({
        callbackId: "feedback_form",
        title: "Send Feedback",
        submitLabel: "Send",
        closeLabel: "Cancel",
        children: [
          TextInput({
            id: "feedback",
            label: "Feedback",
            placeholder: "Type here...",
          }),
        ],
      }),
      "ctx-modal-1"
    );

    expect(view.viewId).toBeTruthy();

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as {
      attachments: Array<{ content: { body: unknown[]; actions: unknown[] } }>;
      parentId?: string;
      roomId?: string;
    };

    expect(body.roomId).toBe("room-modal-1");
    expect(body.parentId).toBe("root-modal-1");
    const content = body.attachments[0].content;
    expect(content.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "Input.Text", id: "feedback" }),
      ])
    );
    expect(content.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "Action.Submit",
          data: expect.objectContaining({
            _chat_modal: "1",
            _chat_modal_callback_id: "feedback_form",
          }),
        }),
      ])
    );
    expect(
      state.cache.get(`webex:modal:view:${view.viewId}`)
    ).toMatchObject({
      callbackId: "feedback_form",
      contextId: "ctx-modal-1",
      threadId,
      viewId: view.viewId,
    });
  });

  it("throws NotImplementedError when adding reactions", async () => {
    const fetchMock = vi.mocked(fetch);

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await expect(
      adapter.addReaction(threadId, "msg-1", "thumbs_up")
    ).rejects.toMatchObject({
      name: "NotImplementedError",
      code: "NOT_IMPLEMENTED",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws NotImplementedError when removing reactions", async () => {
    const fetchMock = vi.mocked(fetch);

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await expect(
      adapter.removeReaction(threadId, "msg-1", "thumbs_up")
    ).rejects.toMatchObject({
      name: "NotImplementedError",
      code: "NOT_IMPLEMENTED",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("webhook signature verification", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("accepts any request when webhookSecret is not configured", async () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      logger: mockLogger,
    });
    const state = createMockState();
    await adapter.initialize(createMockChat(state));

    const body = JSON.stringify({
      resource: "messages",
      event: "created",
      data: {},
    });

    const request = new Request("https://example.com/webhooks/webex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });

  it("rejects when signature header is missing and secret is set", async () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    await adapter.initialize(createMockChat(state));

    const body = JSON.stringify({ resource: "messages", event: "created" });

    const request = new Request("https://example.com/webhooks/webex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid JSON bodies", async () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      logger: mockLogger,
    });
    const state = createMockState();
    await adapter.initialize(createMockChat(state));

    const body = "not valid json!!";
    const request = new Request("https://example.com/webhooks/webex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(400);
  });
});

describe("self-message filtering", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ignores messages sent by the bot itself", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-self",
        roomId: "room-1",
        personId: "bot-person-id",
        personEmail: "bot@example.com",
        text: "I sent this",
        created: "2026-02-24T20:00:00.000Z",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);
    const tracker = createWaitUntilTracker();

    const body = JSON.stringify({
      resource: "messages",
      event: "created",
      data: { id: "msg-self" },
    });
    await adapter.handleWebhook(createWebhookRequest(body, "secret"), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    expect(chat.processMessage).not.toHaveBeenCalled();
  });
});

describe("initialize", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches bot identity from /people/me", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "bot-id-from-api",
        displayName: "My Bot",
        nickName: "Bot",
        type: "bot",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      logger: mockLogger,
    });
    const state = createMockState();
    await adapter.initialize(createMockChat(state));

    expect(adapter.botUserId).toBe("bot-id-from-api");
    expect(adapter.userName).toBe("Bot");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/people/me");
  });

  it("skips /people/me call when botUserId is provided", async () => {
    const fetchMock = vi.mocked(fetch);

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "pre-set-id",
      logger: mockLogger,
    });
    const state = createMockState();
    await adapter.initialize(createMockChat(state));

    expect(adapter.botUserId).toBe("pre-set-id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs warning and continues when /people/me fails", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Unauthorized" }, 401)
    );

    const adapter = createWebexAdapter({
      botToken: "bad-token",
      logger: mockLogger,
    });
    const state = createMockState();
    await adapter.initialize(createMockChat(state));

    expect(adapter.botUserId).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

describe("parseMessage", () => {
  it("parses a raw WebexMessage into a Chat Message", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-id",
      logger: mockLogger,
    });

    const message = adapter.parseMessage({
      id: "msg-1",
      roomId: "room-1",
      personId: "user-1",
      personEmail: "alice@example.com",
      personDisplayName: "Alice",
      text: "Hello world",
      created: "2026-02-24T20:00:00.000Z",
    });

    expect(message.text).toBe("Hello world");
    expect(message.id).toBe("msg-1");
    expect(message.author.userId).toBe("user-1");
    expect(message.author.userName).toBe("alice");
    expect(message.author.fullName).toBe("Alice");
    expect(message.author.isBot).toBe(false);
    expect(message.author.isMe).toBe(false);
  });

  it("detects bot authors via personType", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-id",
      logger: mockLogger,
    });

    const message = adapter.parseMessage({
      id: "msg-2",
      roomId: "room-1",
      personId: "other-bot",
      personType: "bot",
      text: "Automated",
    });

    expect(message.author.isBot).toBe(true);
  });

  it("detects own messages via personId matching botUserId", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-id",
      logger: mockLogger,
    });

    const message = adapter.parseMessage({
      id: "msg-3",
      roomId: "room-1",
      personId: "bot-id",
      text: "I said this",
    });

    expect(message.author.isMe).toBe(true);
  });

  it("uses parentId as rootMessageId when present", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-id",
      logger: mockLogger,
    });

    const message = adapter.parseMessage({
      id: "msg-reply",
      roomId: "room-1",
      parentId: "root-msg",
      personId: "user-1",
      text: "Reply",
    });

    const decoded = adapter.decodeThreadId(message.threadId);
    expect(decoded.rootMessageId).toBe("root-msg");
  });

  it("detects mentions in direct rooms", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-id",
      logger: mockLogger,
    });

    const message = adapter.parseMessage({
      id: "msg-dm",
      roomId: "room-dm",
      roomType: "direct",
      personId: "user-1",
      text: "hello",
    });

    expect(message.isMention).toBe(true);
  });

  it("detects mentions via mentionedPeople array", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-id",
      logger: mockLogger,
    });

    const message = adapter.parseMessage({
      id: "msg-mention",
      roomId: "room-group",
      personId: "user-1",
      text: "Hey bot",
      mentionedPeople: ["bot-id"],
    });

    expect(message.isMention).toBe(true);
  });

  it("creates file attachments from file URLs", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-id",
      logger: mockLogger,
    });

    const message = adapter.parseMessage({
      id: "msg-file",
      roomId: "room-1",
      personId: "user-1",
      text: "See file",
      files: ["https://webexapis.com/v1/contents/file-id/photo.png"],
    });

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].type).toBe("image");
    expect(message.attachments[0].url).toContain("photo.png");
  });
});

describe("isDM", () => {
  it("returns true for DM thread IDs", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "dm:person-123",
      rootMessageId: "root",
    });
    expect(adapter.isDM(threadId)).toBe(true);
  });

  it("returns false for group thread IDs", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-regular",
      rootMessageId: "root",
    });
    expect(adapter.isDM(threadId)).toBe(false);
  });
});

describe("openDM", () => {
  it("creates a DM thread ID with dm: prefix and root sentinel", async () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = await adapter.openDM("person-456");
    const decoded = adapter.decodeThreadId(threadId);
    expect(decoded.roomId).toBe("dm:person-456");
    expect(decoded.rootMessageId).toBe("root");
    expect(adapter.isDM(threadId)).toBe(true);
  });
});

describe("channelIdFromThreadId", () => {
  it("returns a channel ID derived from the thread's room ID", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });
    const channelId = adapter.channelIdFromThreadId(threadId);
    expect(channelId).toMatch(/^webex:/);
  });
});

describe("renderFormatted", () => {
  it("renders formatted content using the format converter", () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const result = adapter.renderFormatted({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "formatted output" }],
        },
      ],
    });
    expect(result).toContain("formatted output");
  });
});

describe("editMessage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("edits a message with new text content", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-1",
        roomId: "room-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    const result = await adapter.editMessage(threadId, "msg-1", "Updated text");
    expect(result.id).toBe("msg-1");

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.method).toBe("PUT");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/messages/msg-1");
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.markdown).toContain("Updated text");
  });

  it("rejects editing messages with file uploads", async () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await expect(
      adapter.editMessage(threadId, "msg-1", {
        markdown: "Updated",
        files: [
          {
            filename: "a.txt",
            data: Buffer.from("a"),
            mimeType: "text/plain",
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
    });
  });

  it("edits a message with card content", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-1",
        roomId: "room-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await adapter.editMessage(threadId, "msg-1", {
      card: {
        type: "card",
        title: "Updated Card",
        children: [],
      },
    });

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.attachments).toBeTruthy();
    expect(body.markdown).toContain("Updated Card");
  });
});

describe("deleteMessage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends a DELETE request to the Webex API", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await adapter.deleteMessage(threadId, "msg-to-delete");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/messages/msg-to-delete");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });
});

describe("handleWebhook - threaded messages", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses parentId as root when message is a thread reply", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-reply",
        roomId: "room-1",
        parentId: "root-msg",
        personId: "user-1",
        personEmail: "user@example.com",
        text: "Thread reply",
        created: "2026-02-24T20:00:00.000Z",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);
    const tracker = createWaitUntilTracker();

    const body = JSON.stringify({
      resource: "messages",
      event: "created",
      data: { id: "msg-reply" },
    });
    await adapter.handleWebhook(createWebhookRequest(body, "secret"), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const threadId = (chat.processMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    const decoded = adapter.decodeThreadId(threadId);
    expect(decoded.rootMessageId).toBe("root-msg");
  });
});

describe("handleWebhook - modal close", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("routes modal close actions to processModalClose", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "action-close-1",
        type: "submit",
        messageId: "msg-modal-close",
        personId: "user-2",
        inputs: {
          actionId: "__chat_modal_close:view-close-1",
          _chat_modal: "1",
          _chat_modal_action: "close",
          _chat_modal_view_id: "view-close-1",
          _chat_modal_callback_id: "feedback_form",
        },
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-modal-close",
        roomId: "room-modal-close",
        personId: "user-1",
        text: "Modal card",
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "user-2",
        displayName: "User Two",
        emails: ["user2@example.com"],
      })
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);
    const tracker = createWaitUntilTracker();

    const body = JSON.stringify({
      resource: "attachmentActions",
      event: "created",
      data: { id: "action-close-1" },
    });
    const response = await adapter.handleWebhook(
      createWebhookRequest(body, "secret"),
      { waitUntil: tracker.waitUntil }
    );

    expect(response.status).toBe(200);
    await tracker.waitForAll();
    expect(chat.processAction).not.toHaveBeenCalled();
    expect(chat.processModalSubmit).not.toHaveBeenCalled();
    expect(chat.processModalClose).toHaveBeenCalledTimes(1);
    const closeEvent = (chat.processModalClose as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(closeEvent.callbackId).toBe("feedback_form");
    expect(closeEvent.viewId).toBe("view-close-1");
  });
});

describe("handleWebhook - missing data", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ignores messages.created when data.id is missing", async () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);
    const tracker = createWaitUntilTracker();

    const body = JSON.stringify({
      resource: "messages",
      event: "created",
      data: {},
    });
    await adapter.handleWebhook(createWebhookRequest(body, "secret"), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it("returns 200 when chat is not initialized", async () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      logger: mockLogger,
    });

    const body = JSON.stringify({
      resource: "messages",
      event: "created",
      data: { id: "msg-1" },
    });

    const request = new Request("https://example.com/webhooks/webex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(200);
  });
});

describe("postMessage - file uploads", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends a single file via multipart FormData", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-file-1",
        roomId: "room-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await adapter.postMessage(threadId, {
      markdown: "File attached",
      files: [
        {
          filename: "test.txt",
          data: Buffer.from("hello"),
          mimeType: "text/plain",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.body).toBeInstanceOf(FormData);
  });

  it("rejects cards with file uploads in the same message", async () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await expect(
      adapter.postMessage(threadId, {
        card: { type: "card", title: "Test", children: [] },
        files: [
          {
            filename: "a.txt",
            data: Buffer.from("a"),
            mimeType: "text/plain",
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
    });
  });
});
