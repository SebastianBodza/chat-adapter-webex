import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
} from "@chat-adapter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALICE, BOB, BOT, createHarness, type Harness } from "./harness";

const GROUP = "room-group";
const DIRECT = "room-direct";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe("history, threads and channel metadata", () => {
  let h: Harness;

  beforeEach(async () => {
    h = createHarness();
    h.api.addRoom({ id: GROUP, type: "group", title: "Release crew", isLocked: true });
    h.api.addRoom({ id: DIRECT, type: "direct", title: "Alice Example" });
    await h.init();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("iterates a long DM history across multiple API pages in chronological order", async () => {
    for (let index = 1; index <= 230; index += 1) {
      h.api.addMessage({ roomId: DIRECT, personId: index % 2 ? ALICE.id : BOT.id, text: `m${index}` });
    }
    const threadId = h.adapter.encodeThreadId({ roomId: DIRECT, rootMessageId: "root" });
    // Seed the room type cache the same way an inbound DM webhook would.
    h.adapter.parseMessage({ id: "seed", roomId: DIRECT, roomType: "direct" });

    const messages = await collect(h.chat.channel(h.adapter.channelIdFromThreadId(threadId)).messages);
    expect(messages).toHaveLength(230);

    const forward = await h.adapter.fetchMessages(threadId, { direction: "forward", limit: 100 });
    expect(forward.messages[0]?.text).toBe("m1");
    expect(forward.messages.at(-1)?.text).toBe("m100");
    expect(forward.nextCursor).toBe(forward.messages.at(-1)?.id);

    const page2 = await h.adapter.fetchMessages(threadId, { direction: "forward", limit: 100, cursor: forward.nextCursor });
    const page3 = await h.adapter.fetchMessages(threadId, { direction: "forward", limit: 100, cursor: page2.nextCursor });
    expect(page2.messages.map((message) => message.text).slice(0, 2)).toEqual(["m101", "m102"]);
    expect(page3.messages.map((message) => message.text).at(-1)).toBe("m230");
    expect(page3.nextCursor).toBeUndefined();

    // The adapter pages Webex with beforeMessage and the maximum page size.
    const listCalls = h.api.requestsTo("GET", "/messages");
    expect(listCalls.some((request) => request.query.has("beforeMessage"))).toBe(true);
    expect(listCalls.every((request) => Number(request.query.get("max")) <= 100)).toBe(true);
  });

  it("returns the most recent messages first-page-last when fetching backward", async () => {
    for (let index = 1; index <= 8; index += 1) {
      h.api.addMessage({ roomId: DIRECT, personId: ALICE.id, text: `m${index}` });
    }
    const threadId = h.adapter.encodeThreadId({ roomId: DIRECT, rootMessageId: "root" });

    const latest = await h.adapter.fetchMessages(threadId, { limit: 3 });
    expect(latest.messages.map((message) => message.text)).toEqual(["m6", "m7", "m8"]);

    const older = await h.adapter.fetchMessages(threadId, { limit: 3, cursor: latest.nextCursor });
    expect(older.messages.map((message) => message.text)).toEqual(["m3", "m4", "m5"]);
  });

  it("falls back to mentionedPeople=me when Webex forbids listing a group space", async () => {
    const root = h.api.addMessage({ roomId: GROUP, personId: ALICE.id, text: "@helper root", mentionedPeople: [BOT.id] });
    h.api.addMessage({ roomId: GROUP, personId: BOB.id, text: "unrelated chatter" });
    h.api.addMessage({ roomId: GROUP, parentId: root.id, personId: BOB.id, text: "@helper reply", mentionedPeople: [BOT.id] });

    const threadId = h.adapter.encodeThreadId({ roomId: GROUP, rootMessageId: root.id });
    const result = await h.adapter.fetchMessages(threadId);

    expect(result.messages.map((message) => message.text)).toEqual(["@helper root", "@helper reply"]);
    const listCalls = h.api.requestsTo("GET", "/messages");
    expect(listCalls.map((request) => request.query.get("mentionedPeople"))).toEqual([null, "me"]);

    // The room is remembered as a group space, so the next fetch goes straight to the filter.
    await h.adapter.fetchMessages(threadId);
    expect(h.api.requestsTo("GET", "/messages").map((request) => request.query.get("mentionedPeople"))).toEqual([
      null,
      "me",
      "me",
    ]);
  });

  it("only returns messages of the requested thread", async () => {
    // A space the bot may list without a mention filter (no room type known).
    h.api.addRoom({ id: "room-open" });
    const a = h.api.addMessage({ roomId: "room-open", personId: ALICE.id, text: "thread A" });
    const b = h.api.addMessage({ roomId: "room-open", personId: BOB.id, text: "thread B" });
    h.api.addMessage({ roomId: "room-open", parentId: a.id, personId: BOB.id, text: "A.1" });
    h.api.addMessage({ roomId: "room-open", parentId: b.id, personId: ALICE.id, text: "B.1" });
    h.api.addMessage({ roomId: "room-open", parentId: a.id, personId: ALICE.id, text: "A.2" });

    const thread = h.adapter.encodeThreadId({ roomId: "room-open", rootMessageId: a.id });
    const backward = await h.adapter.fetchMessages(thread);
    const forward = await h.adapter.fetchMessages(thread, { direction: "forward" });

    expect(backward.messages.map((message) => message.text)).toEqual(["thread A", "A.1", "A.2"]);
    expect(forward.messages.map((message) => message.text)).toEqual(["thread A", "A.1", "A.2"]);
    expect(backward.messages.every((message) => message.threadId === thread)).toBe(true);
  });

  it("lists threads by most recent activity with reply counts", async () => {
    h.api.addRoom({ id: "room-board" });
    const older = h.api.addMessage({ roomId: "room-board", personId: ALICE.id, text: "older topic" });
    const newer = h.api.addMessage({ roomId: "room-board", personId: BOB.id, text: "newer topic" });
    const quiet = h.api.addMessage({ roomId: "room-board", personId: BOB.id, text: "no replies" });
    h.api.addMessage({ roomId: "room-board", parentId: newer.id, personId: ALICE.id, text: "n.1" });
    const lastReply = h.api.addMessage({ roomId: "room-board", parentId: older.id, personId: BOB.id, text: "o.1" });
    h.api.addMessage({ roomId: "room-board", parentId: older.id, personId: BOB.id, text: "o.2" });

    const channelId = h.adapter.channelIdFromThreadId(h.adapter.encodeThreadId({ roomId: "room-board", rootMessageId: "x" }));
    const threads = await collect(h.chat.channel(channelId).threads());

    expect(threads.map((thread) => thread.rootMessage.text)).toEqual(["older topic", "newer topic", "no replies"]);
    expect(threads.map((thread) => thread.replyCount)).toEqual([2, 1, undefined]);
    expect(threads[0]?.lastReplyAt?.getTime()).toBeGreaterThan(Date.parse(lastReply.created ?? ""));
    expect(threads[2]?.id).toBe(h.adapter.encodeThreadId({ roomId: "room-board", rootMessageId: quiet.id }));

    const firstPage = await h.adapter.listThreads(channelId, { limit: 2 });
    expect(firstPage.threads).toHaveLength(2);
    const secondPage = await h.adapter.listThreads(channelId, { limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.threads.map((thread) => thread.rootMessage.text)).toEqual(["no replies"]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("fetches channel and thread metadata from the rooms API", async () => {
    const root = h.api.addMessage({ roomId: GROUP, personId: ALICE.id, text: "@helper kickoff" });
    const threadId = h.adapter.encodeThreadId({ roomId: GROUP, rootMessageId: root.id });

    const channel = await h.chat.channel(h.adapter.channelIdFromThreadId(threadId)).fetchMetadata();
    expect(channel).toMatchObject({ name: "Release crew", isDM: false, metadata: { roomId: GROUP, type: "group", isLocked: true } });

    const thread = await h.adapter.fetchThread(threadId);
    expect(thread).toMatchObject({
      id: threadId,
      channelName: "Release crew",
      isDM: false,
      metadata: { roomId: GROUP, rootMessageId: root.id, rootMessage: expect.objectContaining({ text: "@helper kickoff" }) },
    });
  });

  it("reports unopened DMs without calling the rooms API", async () => {
    const threadId = await h.adapter.openDM(BOB.id);
    const info = await h.adapter.fetchChannelInfo(h.adapter.channelIdFromThreadId(threadId));
    expect(info.isDM).toBe(true);
    expect((await h.adapter.listThreads(h.adapter.channelIdFromThreadId(threadId))).threads).toEqual([]);
    expect(h.api.requestsTo("GET", /^\/rooms\//)).toHaveLength(0);
  });

  it("fetchMessage returns null for deleted messages", async () => {
    const threadId = h.adapter.encodeThreadId({ roomId: GROUP, rootMessageId: "gone" });
    expect(await h.adapter.fetchMessage(threadId, "gone")).toBeNull();
  });
});

describe("Webex API error mapping", () => {
  let h: Harness;
  let threadId: string;

  beforeEach(async () => {
    h = createHarness();
    h.api.addRoom({ id: GROUP, type: "group" });
    await h.init();
    threadId = h.adapter.encodeThreadId({ roomId: GROUP, rootMessageId: "root" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps 401 to AuthenticationError (e.g. a revoked bot token)", async () => {
    vi.unstubAllGlobals();
    const revoked = createHarness({ adapter: { botToken: "revoked-token" } });
    revoked.api.addRoom({ id: GROUP, type: "group" });

    const error = await revoked.adapter.postMessage(threadId, "hi").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as Error).message).toContain("valid access token");
  });

  it("maps 403 to PermissionError", async () => {
    h.api.failNext({ method: "POST", path: "/messages" }, 403, { body: { message: "Not a member" } });
    await expect(h.adapter.postMessage(threadId, "hi")).rejects.toBeInstanceOf(PermissionError);
  });

  it("maps 429 to AdapterRateLimitError with Retry-After", async () => {
    h.api.failNext({ method: "POST", path: "/messages" }, 429, {
      body: { message: "Too many requests" },
      headers: { "retry-after": "17" },
    });
    const error = await h.adapter.postMessage(threadId, "hi").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdapterRateLimitError);
    expect((error as AdapterRateLimitError).retryAfter).toBe(17);
  });

  it("maps 5xx to NetworkError and keeps the Webex error description", async () => {
    h.api.failNext({ method: "POST", path: "/messages" }, 503, {
      body: { errors: [{ description: "Service temporarily unavailable" }] },
    });
    const error = await h.adapter.postMessage(threadId, "hi").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as Error).message).toContain("Service temporarily unavailable");
  });

  it("rejects replies to unknown parents with the Webex validation message", async () => {
    const error = await h.adapter
      .postMessage(h.adapter.encodeThreadId({ roomId: GROUP, rootMessageId: "missing-parent" }), "hi")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as Error).message).toContain("Parent message not found");
  });

  it("does not let a failing handler reply break webhook acknowledgement", async () => {
    h.chat.onNewMention(async (thread) => {
      await thread.post("will fail");
    });
    h.api.failNext({ method: "POST", path: "/messages" }, 500, { body: { message: "boom" } });

    const { response } = await h.deliverMessage({
      roomId: GROUP,
      personId: ALICE.id,
      text: "@helper hi",
      mentionedPeople: [BOT.id],
    });

    expect(response.status).toBe(200);
    // The handler really tried to reply exactly once, and the failure did not leak.
    const attempts = h.api.requestsTo("POST", "/messages");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.body).toMatchObject({ roomId: GROUP, markdown: "will fail" });
    expect(h.api.botMessages()).toHaveLength(0);
  });
});
