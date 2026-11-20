import { createHmac } from "node:crypto";
import type { Message, Thread } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALICE, BOT, createHarness, type Harness, WEBHOOK_SECRET } from "./harness";

const ROOM = "room-engineering";

describe("webhook ingress", () => {
  let h: Harness;
  let mentions: Array<{ message: Message; thread: Thread }>;

  beforeEach(() => {
    h = createHarness();
    h.api.addRoom({ id: ROOM, type: "group", title: "Engineering" });
    mentions = [];
    h.chat.onNewMention(async (thread, message) => {
      mentions.push({ thread, message });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("signature verification", () => {
    const payload = { resource: "messages", event: "created", data: { id: "missing" } };
    const body = JSON.stringify(payload);

    it("accepts a lowercase hex HMAC-SHA1 signature", async () => {
      const signature = createHmac("sha1", WEBHOOK_SECRET).update(body).digest("hex");
      const response = await h.sendRawWebhook(body, { "x-spark-signature": signature });
      expect(response.status).toBe(200);
    });

    it("accepts an uppercase hex signature with a sha1= prefix", async () => {
      const signature = createHmac("sha1", WEBHOOK_SECRET).update(body).digest("hex").toUpperCase();
      const response = await h.sendRawWebhook(body, { "x-spark-signature": `sha1=${signature}` });
      expect(response.status).toBe(200);
    });

    it("accepts a base64 encoded signature", async () => {
      const signature = createHmac("sha1", WEBHOOK_SECRET).update(body).digest("base64");
      const response = await h.sendRawWebhook(body, { "x-spark-signature": signature });
      expect(response.status).toBe(200);
    });

    it("rejects a signature produced with the wrong secret", async () => {
      const response = await h.sendWebhook(payload, "not-the-secret");
      expect(response.status).toBe(401);
      expect(h.api.requests).toHaveLength(0);
    });

    it("rejects an unsigned webhook when a secret is configured", async () => {
      const response = await h.sendWebhook(payload, null);
      expect(response.status).toBe(401);
    });

    it("rejects a body that was tampered with after signing", async () => {
      const signature = createHmac("sha1", WEBHOOK_SECRET).update(body).digest("hex");
      const tampered = body.replace("missing", "msg-evil");
      const response = await h.sendRawWebhook(tampered, { "x-spark-signature": signature });
      expect(response.status).toBe(401);
      expect(h.api.requests).toHaveLength(0);
    });

    it("skips verification when no webhook secret is configured", async () => {
      vi.unstubAllGlobals();
      const open = createHarness({ adapter: { webhookSecret: undefined } });
      const response = await open.sendWebhook(payload, null);
      expect(response.status).toBe(200);
    });
  });

  it("returns 400 for a correctly signed but malformed JSON body", async () => {
    const body = "{not json";
    const signature = createHmac("sha1", WEBHOOK_SECRET).update(body).digest("hex");
    const response = await h.sendRawWebhook(body, { "x-spark-signature": signature });
    expect(response.status).toBe(400);
  });

  it("acknowledges unrelated resources/events without calling the Webex API", async () => {
    for (const payload of [
      { resource: "messages", event: "deleted", data: { id: "msg-1" } },
      { resource: "memberships", event: "created", data: { id: "membership-1" } },
      { resource: "rooms", event: "updated", data: { id: ROOM } },
      { resource: "messages", event: "created", data: {} },
    ]) {
      const response = await h.sendWebhook(payload);
      expect(response.status).toBe(200);
    }
    expect(h.api.requests).toHaveLength(0);
    expect(mentions).toHaveLength(0);
  });

  it("hydrates the full message from the API because webhooks only carry IDs", async () => {
    const { message, response } = await h.deliverMessage({
      roomId: ROOM,
      personId: ALICE.id,
      text: "@helper please deploy",
      markdown: "<spark-mention data-object-type=\"person\">helper</spark-mention> please **deploy**",
      mentionedPeople: [BOT.id],
    });

    expect(response.status).toBe(200);
    const getRequests = h.api.requestsTo("GET", `/messages/${message.id}`);
    expect(getRequests).toHaveLength(1);
    expect(getRequests[0]?.headers.get("authorization")).toBe("Bearer integration-bot-token");

    expect(mentions).toHaveLength(1);
    const received = mentions[0]?.message;
    expect(received?.id).toBe(message.id);
    expect(received?.isMention).toBe(true);
    expect(received?.author).toMatchObject({
      userId: ALICE.id,
      userName: "alice",
      fullName: "Alice Example",
      isBot: false,
      isMe: false,
    });
    expect(received?.metadata.dateSent.toISOString()).toBe(message.created);
    expect(mentions[0]?.thread.id).toBe(
      h.adapter.encodeThreadId({ roomId: ROOM, rootMessageId: message.id })
    );
    expect(mentions[0]?.thread.isDM).toBe(false);
  });

  it("detects mentions by @username when mentionedPeople is absent", async () => {
    await h.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "hey @Helper, status?" });
    expect(mentions).toHaveLength(1);
  });

  it("treats @all mentions as mentions of the bot", async () => {
    await h.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "@All standup", mentionedPeople: ["all"] });
    expect(mentions).toHaveLength(1);
  });

  it("does not raise mention events for group chatter that does not address the bot", async () => {
    const seen: string[] = [];
    h.chat.onNewMessage(/.*/, async (_thread, message) => {
      seen.push(message.text);
    });

    await h.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "lunch anyone? @helperbot" });

    expect(mentions).toHaveLength(0);
    expect(seen).toEqual(["lunch anyone? @helperbot"]);
  });

  it("routes onNewMessage pattern handlers", async () => {
    const commands: string[] = [];
    h.chat.onNewMessage(/^!deploy (\w+)/, async (_thread, message) => {
      commands.push(message.text);
    });

    await h.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "!deploy staging" });
    await h.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "deploy staging" });

    expect(commands).toEqual(["!deploy staging"]);
  });

  it("ignores messages authored by the bot itself", async () => {
    await h.deliverMessage({ roomId: ROOM, personId: BOT.id, text: "@helper echo", mentionedPeople: [BOT.id] });
    expect(mentions).toHaveLength(0);
  });

  it("acknowledges and drops webhooks for messages that were deleted before hydration", async () => {
    const response = await h.sendWebhook({
      resource: "messages",
      event: "created",
      data: { id: "msg-already-deleted" },
    });

    expect(response.status).toBe(200);
    expect(mentions).toHaveLength(0);
    expect(h.logger.entries.filter((entry) => entry.level === "error")).toHaveLength(0);
  });

  it("acknowledges the webhook and logs when hydration fails with a server error", async () => {
    const stored = h.api.addMessage({ roomId: ROOM, personId: ALICE.id, text: "@helper hi", mentionedPeople: [BOT.id] });
    h.api.failNext({ method: "GET", path: `/messages/${stored.id}` }, 502, { body: { message: "Bad gateway" } });

    const response = await h.sendWebhook({ resource: "messages", event: "created", data: { id: stored.id } });

    expect(response.status).toBe(200);
    expect(mentions).toHaveLength(0);
    const errors = h.logger.entries.filter((entry) => entry.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("Error handling Webex webhook");
  });

  it("deduplicates webhook redeliveries of the same message", async () => {
    const { message } = await h.deliverMessage({
      roomId: ROOM,
      personId: ALICE.id,
      text: "@helper once",
      mentionedPeople: [BOT.id],
    });
    await h.sendWebhook({ resource: "messages", event: "created", data: { id: message.id } });

    expect(mentions).toHaveLength(1);
  });

  it("parses incoming file attachments and downloads them with the bot token", async () => {
    const fileUrl = h.api.addFile("diagram.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png");

    await h.deliverMessage({
      roomId: ROOM,
      personId: ALICE.id,
      text: "@helper see attached",
      mentionedPeople: [BOT.id],
      files: [fileUrl],
    });

    const attachments = mentions[0]?.message.attachments ?? [];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ type: "image", name: "diagram.png", mimeType: "image/png", url: fileUrl });

    const data = await attachments[0]?.fetchData?.();
    expect(data && [...new Uint8Array(data)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const download = h.api.requests.find((request) => request.url === fileUrl);
    expect(download?.headers.get("authorization")).toBe("Bearer integration-bot-token");
  });

  it("surfaces attachment download failures as errors", async () => {
    await h.deliverMessage({
      roomId: ROOM,
      personId: ALICE.id,
      text: "@helper broken file",
      mentionedPeople: [BOT.id],
      files: ["https://files.webexapis.test/contents/gone/report.pdf"],
    });

    const attachment = mentions[0]?.message.attachments[0];
    expect(attachment?.type).toBe("file");
    await expect(attachment?.fetchData?.()).rejects.toThrow("Failed to fetch attachment: 404");
  });

  describe("bot identity", () => {
    it("discovers its own person ID via /people/me and filters its own echoes", async () => {
      vi.unstubAllGlobals();
      const discovering = createHarness({ discoverBotIdentity: true });
      discovering.api.addRoom({ id: ROOM, type: "group" });
      const seen: string[] = [];
      discovering.chat.onNewMention(async (_thread, message) => {
        seen.push(message.text);
      });

      await discovering.deliverMessage({ roomId: ROOM, personId: BOT.id, text: "@helper loop", mentionedPeople: [BOT.id] });
      await discovering.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "@helper real", mentionedPeople: [BOT.id] });

      expect(discovering.api.requestsTo("GET", "/people/me")).toHaveLength(1);
      expect(discovering.adapter.botUserId).toBe(BOT.id);
      expect(discovering.adapter.userName).toBe("helper");
      expect(seen).toEqual(["@helper real"]);
    });

    it("keeps working with configured defaults when /people/me fails", async () => {
      vi.unstubAllGlobals();
      const degraded = createHarness({ discoverBotIdentity: true });
      degraded.api.addRoom({ id: ROOM, type: "group" });
      degraded.api.failNext({ method: "GET", path: "/people/me" }, 500, { body: { message: "boom" } });
      const seen: string[] = [];
      degraded.chat.onNewMention(async (_thread, message) => {
        seen.push(message.text);
      });

      const { response } = await degraded.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "@helper still there?" });

      expect(response.status).toBe(200);
      expect(degraded.adapter.botUserId).toBeUndefined();
      expect(seen).toEqual(["@helper still there?"]);
      expect(degraded.logger.entries.some((entry) => entry.message === "Could not fetch Webex bot identity")).toBe(true);
    });
  });
});
