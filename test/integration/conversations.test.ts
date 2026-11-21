import { ValidationError } from "@chat-adapter/shared";
import { Actions, Button, Card, CardText, type Message, paragraph, root, strong, text, type Thread } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adaptiveCardOf, ALICE, BOB, BOT, BOT_TOKEN, createHarness, type Harness } from "./harness";

const ROOM = "room-engineering";

describe("conversations end to end", () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
    h.api.addRoom({ id: ROOM, type: "group", title: "Engineering" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs a full mention → subscribe → threaded follow-up → unsubscribe conversation", async () => {
    const replies: string[] = [];
    h.chat.onNewMention(async (thread) => {
      await thread.subscribe();
      await thread.post("On it. Reply here with the environment.");
    });
    h.chat.onSubscribedMessage(async (thread, message) => {
      replies.push(message.text);
      if (message.text === "stop") {
        await thread.post("Okay, unsubscribing.");
        await thread.unsubscribe();
        return;
      }
      await thread.post(`Deploying to **${message.text}**`);
    });

    const { message: root } = await h.deliverMessage({
      roomId: ROOM,
      personId: ALICE.id,
      text: "@helper deploy please",
      mentionedPeople: [BOT.id],
    });
    await h.deliverMessage({ roomId: ROOM, parentId: root.id, personId: ALICE.id, text: "staging" });
    await h.deliverMessage({ roomId: ROOM, parentId: root.id, personId: BOB.id, text: "stop" });
    await h.deliverMessage({ roomId: ROOM, parentId: root.id, personId: ALICE.id, text: "after unsubscribe" });

    expect(replies).toEqual(["staging", "stop"]);

    const posted = h.api.botMessages();
    expect(posted.map((message) => message.markdown)).toEqual([
      "On it. Reply here with the environment.",
      "Deploying to **staging**",
      "Okay, unsubscribing.",
    ]);
    // Every reply is threaded under the original mention, never under a reply.
    for (const message of posted) {
      expect(message.roomId).toBe(ROOM);
      expect(message.parentId).toBe(root.id);
    }
  });

  it("keeps follow-up mentions inside an existing thread in that thread", async () => {
    // Webex threads are one level deep: every reply (even one answering another
    // reply in the client) carries the root message as its parentId.
    const events: Array<{ kind: "mention" | "subscribed"; threadId: string; text: string }> = [];
    h.chat.onNewMention(async (thread, message) => {
      events.push({ kind: "mention", threadId: thread.id, text: message.text });
      await thread.subscribe();
    });
    h.chat.onSubscribedMessage(async (thread, message) => {
      events.push({ kind: "subscribed", threadId: thread.id, text: message.text });
      await thread.post(`ack: ${message.text}`);
    });

    const { message: root } = await h.deliverMessage({
      roomId: ROOM,
      personId: ALICE.id,
      text: "@helper start",
      mentionedPeople: [BOT.id],
    });
    await h.deliverMessage({ roomId: ROOM, parentId: root.id, personId: BOB.id, text: "@helper more", mentionedPeople: [BOT.id] });
    await h.deliverMessage({ roomId: ROOM, parentId: root.id, personId: ALICE.id, text: "@helper and more", mentionedPeople: [BOT.id] });

    const rootThreadId = h.adapter.encodeThreadId({ roomId: ROOM, rootMessageId: root.id });
    expect(events).toEqual([
      { kind: "mention", threadId: rootThreadId, text: "@helper start" },
      { kind: "subscribed", threadId: rootThreadId, text: "@helper more" },
      { kind: "subscribed", threadId: rootThreadId, text: "@helper and more" },
    ]);
    const replies = h.api.botMessages();
    expect(replies.map((message) => message.markdown)).toEqual(["ack: @helper more", "ack: @helper and more"]);
    expect(replies.every((message) => message.parentId === root.id)).toBe(true);
  });

  it("rejects nested replies the way Webex does", async () => {
    const root = h.api.addMessage({ roomId: ROOM, personId: ALICE.id, text: "root" });
    const reply = h.api.addMessage({ roomId: ROOM, parentId: root.id, personId: BOB.id, text: "reply" });

    await expect(
      h.adapter.postMessage(h.adapter.encodeThreadId({ roomId: ROOM, rootMessageId: reply.id }), "nested")
    ).rejects.toThrow("Replies to replies are not supported.");
  });

  it("isolates two concurrent threads in the same space", async () => {
    h.chat.onNewMention(async (thread, message) => {
      await thread.subscribe();
      await thread.post(`started: ${message.text}`);
    });
    h.chat.onSubscribedMessage(async (thread, message) => {
      await thread.post(`echo: ${message.text}`);
    });

    const { message: first } = await h.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "@helper A", mentionedPeople: [BOT.id] });
    const { message: second } = await h.deliverMessage({ roomId: ROOM, personId: BOB.id, text: "@helper B", mentionedPeople: [BOT.id] });
    await h.deliverMessage({ roomId: ROOM, parentId: second.id, personId: BOB.id, text: "b-reply" });
    await h.deliverMessage({ roomId: ROOM, parentId: first.id, personId: ALICE.id, text: "a-reply" });

    const byParent = (parentId: string) =>
      h.api.botMessages().filter((message) => message.parentId === parentId).map((message) => message.markdown);
    expect(byParent(first.id)).toEqual(["started: @helper A", "echo: a-reply"]);
    expect(byParent(second.id)).toEqual(["started: @helper B", "echo: b-reply"]);
  });

  describe("direct messages", () => {
    it("treats every DM as a mention and keeps the whole DM as one flat thread", async () => {
      const dmThreads: Thread[] = [];
      const followUps: Message[] = [];
      h.chat.onNewMention(async (thread) => {
        dmThreads.push(thread);
        await thread.subscribe();
        await thread.post("Hi Alice!");
      });
      h.chat.onSubscribedMessage(async (thread, message) => {
        followUps.push(message);
        await thread.post(`You said: ${message.text}`);
      });

      h.api.addRoom({ id: "direct-alice", type: "direct" });
      await h.deliverMessage({ roomId: "direct-alice", personId: ALICE.id, text: "hello" });
      await h.deliverMessage({ roomId: "direct-alice", personId: ALICE.id, text: "how are you" });

      expect(dmThreads).toHaveLength(1);
      expect(dmThreads[0]?.isDM).toBe(true);
      expect(followUps.map((message) => message.text)).toEqual(["how are you"]);
      expect(followUps[0]?.threadId).toBe(dmThreads[0]?.id);

      // DM replies must not carry a parentId, otherwise Webex would render a thread.
      const posted = h.api.botMessages();
      expect(posted.map((message) => message.markdown)).toEqual(["Hi Alice!", "You said: how are you"]);
      for (const message of posted) {
        expect(message.roomId).toBe("direct-alice");
        expect(message.parentId).toBeUndefined();
      }
    });

    it("opens a DM by person ID, sends via toPersonId and remembers the created room", async () => {
      await h.init();
      const threadId = await h.adapter.openDM(BOB.id);
      expect(h.adapter.isDM(threadId)).toBe(true);

      // Before the first message there is no room yet, so history is empty.
      expect((await h.adapter.fetchMessages(threadId)).messages).toEqual([]);

      await h.adapter.postMessage(threadId, "Your build finished ✅");
      await h.adapter.postMessage(threadId, { markdown: "Second **notice**" });

      const creates = h.api.requestsTo("POST", "/messages");
      expect(creates.map((request) => request.body)).toEqual([
        { markdown: "Your build finished ✅", toPersonId: BOB.id },
        { markdown: "Second **notice**", toPersonId: BOB.id },
      ]);
      const room = h.api.directRoomFor(BOB.id);
      expect(room).toBeDefined();

      // The person→room mapping is persisted in Chat state for other instances.
      expect(await h.state.get(`webex:dm-room:${BOB.id}`)).toBe(room?.id);

      h.api.addMessage({ roomId: room?.id as string, personId: BOB.id, text: "thanks!" });
      const history = await h.adapter.fetchMessages(threadId);
      expect(history.messages.map((message) => message.text)).toEqual([
        "Your build finished ✅",
        "Second **notice**",
        "thanks!",
      ]);
      expect(history.messages.every((message) => message.threadId === threadId)).toBe(true);
    });

    it("resolves a DM room from shared state in a fresh adapter instance", async () => {
      await h.init();
      const first = await h.adapter.openDM(BOB.id);
      await h.adapter.postMessage(first, "ping");
      const roomId = h.api.directRoomFor(BOB.id)?.id;

      vi.unstubAllGlobals();
      const second = createHarness({ state: h.state });
      second.api.addRoom({ id: roomId as string, type: "direct" });
      second.api.addMessage({ roomId: roomId as string, personId: BOB.id, text: "from another instance" });
      await second.init();

      const history = await second.adapter.fetchMessages(await second.adapter.openDM(BOB.id));
      expect(history.messages.map((message) => message.text)).toEqual(["from another instance"]);
    });
  });

  describe("outbound formatting", () => {
    it("renders markdown, AST and emoji placeholders into Webex markdown", async () => {
      const threadId = h.adapter.encodeThreadId({ roomId: ROOM, rootMessageId: "root" });
      const channelId = h.adapter.channelIdFromThreadId(threadId);
      const channel = h.chat.channel(channelId);

      await channel.post({ markdown: "**Release** _v1.2_ is out {{emoji:rocket}}" });
      await channel.post("Plain text with {{emoji:thumbs_up}}");
      await channel.post({ ast: root([paragraph([strong([text("Build")]), text(" passed {{emoji:party}}")])]) });

      const posted = h.api.botMessages();
      expect(posted[0]?.markdown).toContain("**Release**");
      expect(posted[0]?.markdown).toContain("🚀");
      expect(posted[0]?.markdown).not.toContain("{{emoji:");
      expect(posted[1]?.markdown).toContain("👍");
      expect(posted[2]?.markdown).toContain("**Build** passed");
      expect(posted[2]?.markdown).toContain("🎉");
      // Channel-level posts are top-level messages.
      expect(posted.every((message) => message.parentId === undefined && message.roomId === ROOM)).toBe(true);
    });

    it("sends cards as Adaptive Card attachments with a readable fallback", async () => {
      h.chat.onNewMention(async (thread) => {
        await thread.post(
          Card({
            title: "Deploy v1.2?",
            children: [
              CardText("Production rollout"),
              Actions([
                Button({ id: "approve", label: "Approve", style: "primary", value: "v1.2" }),
                Button({ id: "reject", label: "Reject", style: "danger" }),
              ]),
            ],
          })
        );
      });

      await h.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "@helper release", mentionedPeople: [BOT.id] });

      const [cardMessage] = h.api.botMessages();
      expect(cardMessage?.markdown).toContain("Deploy v1.2?");
      const card = adaptiveCardOf(cardMessage);
      expect(card).toMatchObject({ type: "AdaptiveCard" });
      expect(card.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "Action.Submit", title: "Approve", data: { actionId: "approve", value: "v1.2" } }),
          expect.objectContaining({ type: "Action.Submit", title: "Reject", data: { actionId: "reject" } }),
        ])
      );
    });

    it("uploads a single file as multipart/form-data in the thread", async () => {
      h.chat.onNewMention(async (thread) => {
        await thread.post({
          markdown: "Here is the report",
          files: [{ filename: "q3 report.csv", mimeType: "text/csv", data: Buffer.from("a,b\n1,2\n") }],
        });
      });

      const { message: root } = await h.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "@helper report", mentionedPeople: [BOT.id] });

      const [create] = h.api.requestsTo("POST", "/messages");
      expect(create?.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
      const [posted] = h.api.botMessages();
      expect(posted).toMatchObject({ roomId: ROOM, parentId: root.id, markdown: "Here is the report" });
      expect(posted?.uploadedFiles).toHaveLength(1);
      expect(posted?.uploadedFiles?.[0]).toMatchObject({ name: "q3 report.csv", type: "text/csv" });
      expect(new TextDecoder().decode(posted?.uploadedFiles?.[0]?.bytes)).toBe("a,b\n1,2\n");

      // The uploaded file is downloadable from its content URL, even with a space in its name.
      const fileUrl = posted?.files?.[0] ?? "";
      expect(fileUrl).toMatch(/\/q3%20report\.csv$/);
      const download = await fetch(fileUrl, { headers: { authorization: `Bearer ${BOT_TOKEN}` } });
      expect(download.status).toBe(200);
      expect(await download.text()).toBe("a,b\n1,2\n");
    });

    it("rejects multiple files and card+file combinations before calling Webex", async () => {
      const threadId = h.adapter.encodeThreadId({ roomId: ROOM, rootMessageId: "root" });
      const file = { filename: "a.txt", data: Buffer.from("a") };

      await expect(
        h.adapter.postMessage(threadId, { markdown: "two files", files: [file, { ...file, filename: "b.txt" }] })
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        h.adapter.postMessage(threadId, { card: Card({ title: "x" }), files: [file] })
      ).rejects.toThrow("Sending a card with uploaded files in the same message is not supported.");

      expect(h.api.requestsTo("POST", "/messages")).toHaveLength(0);
    });
  });

  describe("editing and deleting sent messages", () => {
    async function postWorkingMessage() {
      let sent: Awaited<ReturnType<Thread["post"]>> | undefined;
      h.chat.onNewMention(async (thread) => {
        sent = await thread.post("Working… {{emoji:hourglass}}");
      });
      await h.deliverMessage({ roomId: ROOM, personId: ALICE.id, text: "@helper long task", mentionedPeople: [BOT.id] });
      if (!sent) {
        throw new Error("mention handler did not post");
      }
      return sent;
    }

    it("deletes a sent message", async () => {
      const sent = await postWorkingMessage();

      await sent.delete();

      expect(h.api.messages.has(sent.id)).toBe(false);
      expect(h.api.requestsTo("DELETE", `/messages/${sent.id}`)).toHaveLength(1);
    });

    it("edits a sent message in place and sends the roomId Webex requires", async () => {
      const sent = await postWorkingMessage();

      const edited = await sent.edit("Done **✓**");

      expect(edited.id).toBe(sent.id);
      const [put] = h.api.requestsTo("PUT", `/messages/${sent.id}`);
      expect(put?.body).toEqual({ roomId: ROOM, markdown: "Done **✓**" });
      expect(h.api.messages.get(sent.id)?.markdown).toBe("Done **✓**");
    });

    it("edits a direct message using the DM room learned when posting", async () => {
      await h.init();
      const threadId = await h.adapter.openDM(ALICE.id);
      const sent = await h.adapter.postMessage(threadId, "Ping");
      const roomId = h.api.messages.get(sent.id)?.roomId;

      await h.adapter.editMessage(threadId, sent.id, "Pong");

      expect(h.api.requestsTo("PUT", `/messages/${sent.id}`)[0]?.body).toMatchObject({ roomId, markdown: "Pong" });
    });

    it("refuses to edit a direct message whose room is not known yet", async () => {
      await h.init();
      const threadId = await h.adapter.openDM(BOB.id);

      await expect(h.adapter.editMessage(threadId, "msg-unknown", "x")).rejects.toThrow(
        "its Webex room ID is not known yet"
      );
      expect(h.api.requests.filter((request) => request.method === "PUT")).toHaveLength(0);
    });

    it("reports the Webex 10-edit limit as a ValidationError", async () => {
      const sent = await postWorkingMessage();
      for (let edit = 1; edit <= 10; edit++) {
        await sent.edit(`Step ${edit}`);
      }

      const rejected = sent.edit("Step 11");

      await expect(rejected).rejects.toBeInstanceOf(ValidationError);
      await expect(rejected).rejects.toThrow("at most 10 edits per message");
      expect(h.api.messages.get(sent.id)?.markdown).toBe("Step 10");
    });

    // Known bug: https://github.com/SebastianBodza/chat-adapter-webex/issues/9
    // Webex can't edit messages with attachments, yet the adapter PUTs a card.
    // When #9 is fixed this test fails: assert the chosen behaviour instead.
    it("[bug #9] editing into a card sends an attachment edit Webex rejects", async () => {
      const sent = await postWorkingMessage();

      await expect(sent.edit(Card({ title: "Result", children: [CardText("All green")] }))).rejects.toThrow(
        "Editing messages with files or attachments is not supported"
      );

      const [put] = h.api.requestsTo("PUT", `/messages/${sent.id}`);
      expect(put?.body).toMatchObject({
        roomId: ROOM,
        attachments: [expect.objectContaining({ contentType: "application/vnd.microsoft.card.adaptive" })],
      });
      expect(h.api.messages.get(sent.id)?.attachments).toBeUndefined();
    });

    it("refuses to edit a message into a file upload", async () => {
      const threadId = h.adapter.encodeThreadId({ roomId: ROOM, rootMessageId: "root" });
      await expect(
        h.adapter.editMessage(threadId, "msg-1", { markdown: "x", files: [{ filename: "a.txt", data: Buffer.from("a") }] })
      ).rejects.toBeInstanceOf(ValidationError);
      expect(h.api.requests).toHaveLength(0);
    });
  });
});
