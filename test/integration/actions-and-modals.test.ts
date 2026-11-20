import {
  Actions,
  Button,
  Card,
  type ActionEvent,
  Modal,
  type ModalCloseEvent,
  type ModalResponse,
  type ModalSubmitEvent,
  Select,
  SelectOption,
  TextInput,
} from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adaptiveCardOf, ALICE, BOB, BOT, createHarness, type Harness, submitDataOf } from "./harness";
import type { StoredMessage } from "./fake-webex-api";

const ROOM = "room-ops";

const feedbackModal = (title = "Incident report") =>
  Modal({
    callbackId: "incident",
    title,
    submitLabel: "File it",
    closeLabel: "Never mind",
    notifyOnClose: true,
    privateMetadata: JSON.stringify({ source: "button" }),
    children: [
      TextInput({ id: "summary", label: "Summary" }),
      Select({
        id: "severity",
        label: "Severity",
        options: [SelectOption({ label: "Low", value: "low" }), SelectOption({ label: "High", value: "high" })],
      }),
    ],
  });

describe("card actions and modals", () => {
  let h: Harness;
  let root: StoredMessage;
  let cardMessage: StoredMessage;

  /** A mention that the bot answers with an approval card. */
  async function postApprovalCard(): Promise<void> {
    h.chat.onNewMention(async (thread) => {
      await thread.post(
        Card({
          title: "Approve release?",
          children: [
            Actions([
              Button({ id: "approve", label: "Approve", value: "release-42" }),
              Button({ id: "report", label: "Report issue" }),
            ]),
          ],
        })
      );
    });
    ({ message: root } = await h.deliverMessage({
      roomId: ROOM,
      personId: ALICE.id,
      text: "@helper ship it",
      mentionedPeople: [BOT.id],
    }));
    cardMessage = h.api.botMessages()[0] as StoredMessage;
  }

  /** Simulates a user clicking a card's Action.Submit button. */
  function click(message: StoredMessage, title: string, personId: string, inputs: Record<string, string> = {}) {
    return h.deliverAction({
      messageId: message.id,
      roomId: message.roomId,
      personId,
      inputs: { ...submitDataOf(adaptiveCardOf(message), title), ...inputs },
    });
  }

  beforeEach(async () => {
    h = createHarness();
    h.api.addRoom({ id: ROOM, type: "group", title: "Ops" });
    await postApprovalCard();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers a button click to the matching onAction handler with user and thread", async () => {
    const approvals: ActionEvent[] = [];
    const others: string[] = [];
    h.chat.onAction("approve", async (event) => {
      approvals.push(event);
      await event.thread?.post(`Approved ${event.value} by ${event.user.fullName}`);
    });
    h.chat.onAction("reject", async (event) => {
      others.push(event.actionId);
    });

    const { response, action } = await click(cardMessage, "Approve", BOB.id);

    expect(response.status).toBe(200);
    expect(others).toEqual([]);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      actionId: "approve",
      value: "release-42",
      messageId: cardMessage.id,
      triggerId: action.id,
      threadId: h.adapter.encodeThreadId({ roomId: ROOM, rootMessageId: root.id }),
      user: { userId: BOB.id, userName: "bob", fullName: "Bob Example", isBot: false, isMe: false },
    });

    // The reply lands in the same Webex thread as the card.
    const reply = h.api.botMessages().at(-1);
    expect(reply).toMatchObject({ roomId: ROOM, parentId: root.id, markdown: "Approved release-42 by Bob Example" });
  });

  it("caches person lookups across repeated clicks", async () => {
    h.chat.onAction(async () => {});
    await click(cardMessage, "Approve", BOB.id);
    await click(cardMessage, "Approve", BOB.id);
    expect(h.api.requestsTo("GET", `/people/${BOB.id}`)).toHaveLength(1);
  });

  it("falls back to the webhook email when the person lookup fails", async () => {
    const users: ActionEvent["user"][] = [];
    h.chat.onAction(async (event) => {
      users.push(event.user);
    });
    h.api.failNext({ method: "GET", path: `/people/${BOB.id}` }, 500);

    await click(cardMessage, "Approve", BOB.id);

    expect(users[0]).toMatchObject({ userId: BOB.id, fullName: "bob@example.com", userName: "bob@example.com" });
  });

  it("serialises multi-input card submissions as JSON", async () => {
    const values: Array<string | undefined> = [];
    h.chat.onAction("report", async (event) => {
      values.push(event.value);
    });

    await click(cardMessage, "Report issue", ALICE.id, { reason: "flaky", priority: "p2" });

    expect(JSON.parse(values[0] ?? "{}")).toEqual({ actionId: "report", reason: "flaky", priority: "p2" });
  });

  describe("modal lifecycle", () => {
    let submits: ModalSubmitEvent[];
    let closes: ModalCloseEvent[];
    let respond: (event: ModalSubmitEvent) => ModalResponse | undefined;

    beforeEach(() => {
      submits = [];
      closes = [];
      respond = () => undefined;
      h.chat.onAction("report", async (event) => {
        const opened = await event.openModal(feedbackModal());
        expect(opened?.viewId).toEqual(expect.any(String));
      });
      h.chat.onModalSubmit("incident", async (event) => {
        submits.push(event);
        return respond(event);
      });
      h.chat.onModalClose("incident", async (event) => {
        closes.push(event);
      });
    });

    async function openModalCard(): Promise<StoredMessage> {
      await click(cardMessage, "Report issue", ALICE.id);
      const modalMessage = h.api.botMessages().at(-1) as StoredMessage;
      expect(modalMessage.id).not.toBe(cardMessage.id);
      return modalMessage;
    }

    it("posts the modal as an Adaptive Card form in the originating thread", async () => {
      const modalMessage = await openModalCard();

      expect(modalMessage).toMatchObject({ roomId: ROOM, parentId: root.id });
      expect(modalMessage.markdown).toContain("Incident report");
      const card = adaptiveCardOf(modalMessage);
      const body = card.body as Array<Record<string, unknown>>;
      expect(body.map((element) => element.type)).toEqual(["TextBlock", "Input.Text", "Input.ChoiceSet"]);
      expect((card.actions as Array<{ title: string }>).map((action) => action.title)).toEqual([
        "File it",
        "Never mind",
      ]);
    });

    it("submits form values, metadata and related thread, then removes the form card", async () => {
      const modalMessage = await openModalCard();

      await click(modalMessage, "File it", ALICE.id, { summary: "DB is slow", severity: "high" });

      expect(submits).toHaveLength(1);
      const submit = submits[0] as ModalSubmitEvent;
      expect(submit.callbackId).toBe("incident");
      expect(submit.values).toEqual({ summary: "DB is slow", severity: "high" });
      expect(JSON.parse(submit.privateMetadata ?? "{}")).toEqual({ source: "button" });
      expect(submit.user.userId).toBe(ALICE.id);
      expect(submit.relatedThread?.id).toBe(h.adapter.encodeThreadId({ roomId: ROOM, rootMessageId: root.id }));

      // No response → the modal is "closed": the form card is deleted.
      expect(h.api.messages.has(modalMessage.id)).toBe(false);
    });

    it("posts validation errors and keeps the form open", async () => {
      respond = (event) =>
        event.values.summary ? undefined : { action: "errors", errors: { summary: "Summary is required" } };
      const modalMessage = await openModalCard();

      await click(modalMessage, "File it", ALICE.id, { summary: "", severity: "low" });

      expect(h.api.messages.has(modalMessage.id)).toBe(true);
      expect(h.api.botMessages().at(-1)).toMatchObject({
        parentId: root.id,
        markdown: expect.stringContaining("- summary: Summary is required"),
      });

      // A corrected re-submit from the same card still resolves the modal context.
      await click(modalMessage, "File it", ALICE.id, { summary: "Fixed", severity: "low" });
      expect(submits.map((event) => event.values.summary)).toEqual(["", "Fixed"]);
      expect(h.api.messages.has(modalMessage.id)).toBe(false);
    });

    it("updates the form card in place for an update response", async () => {
      respond = () => ({ action: "update", modal: feedbackModal("Step 2: confirm") });
      const modalMessage = await openModalCard();

      await click(modalMessage, "File it", ALICE.id, { summary: "x", severity: "low" });

      const puts = h.api.requestsTo("PUT", `/messages/${modalMessage.id}`);
      expect(puts).toHaveLength(1);
      const updated = h.api.messages.get(modalMessage.id);
      expect(updated?.markdown).toContain("Step 2: confirm");

      // The updated card keeps the same view and is still wired to the handler.
      respond = () => undefined;
      await click(updated as StoredMessage, "File it", ALICE.id, { summary: "y", severity: "high" });
      expect(submits).toHaveLength(2);
      expect(submits[1]?.viewId).toBe(submits[0]?.viewId);
    });

    it("pushes a new form card for a push response", async () => {
      respond = () => ({ action: "push", modal: feedbackModal("Follow-up questions") });
      const modalMessage = await openModalCard();
      const before = h.api.botMessages().length;

      await click(modalMessage, "File it", ALICE.id, { summary: "x", severity: "low" });

      const pushed = h.api.botMessages();
      expect(pushed).toHaveLength(before + 1);
      expect(pushed.at(-1)).toMatchObject({ parentId: root.id, markdown: expect.stringContaining("Follow-up questions") });
      expect(h.api.messages.has(modalMessage.id)).toBe(true);
    });

    it("fires onModalClose and removes the card when the user cancels", async () => {
      const modalMessage = await openModalCard();

      await click(modalMessage, "Never mind", ALICE.id);

      expect(submits).toHaveLength(0);
      expect(closes).toHaveLength(1);
      expect(closes[0]).toMatchObject({ callbackId: "incident", user: { userId: ALICE.id } });
      expect(h.api.messages.has(modalMessage.id)).toBe(false);
    });

    it("still handles a submit when deleting the form card fails", async () => {
      const modalMessage = await openModalCard();
      h.api.failNext({ method: "DELETE", path: `/messages/${modalMessage.id}` }, 403);

      const { response } = await click(modalMessage, "File it", ALICE.id, { summary: "x", severity: "low" });

      expect(response.status).toBe(200);
      expect(submits).toHaveLength(1);
      expect(h.logger.entries.filter((entry) => entry.level === "error")).toHaveLength(0);
    });

    it("ignores modal submissions without a callback ID", async () => {
      const modalMessage = await openModalCard();

      await h.deliverAction({
        messageId: modalMessage.id,
        personId: ALICE.id,
        inputs: { actionId: "__chat_modal_submit:unknown-view", summary: "x" },
      });

      expect(submits).toHaveLength(0);
      expect(h.logger.entries.some((entry) => entry.message === "Webex modal action missing callbackId")).toBe(true);
    });
  });
});
