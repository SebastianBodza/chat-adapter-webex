/**
 * Replays the real-Webex recordings in `fixtures/webex/` (see recordings.ts and
 * scripts/record-webex-fixtures.mjs):
 *
 * 1. Every recorded request is replayed against the fake API, which must give
 *    the same status and error message as real Webex did. This keeps the fake
 *    honest, since all other integration tests rely on it.
 * 2. The recorded webhooks are fed through the adapter, so real payloads (not
 *    hand-written ones) are known to dispatch.
 */
import type { ActionEvent, Message, Thread } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebexAttachmentAction, WebexMessage } from "../../src/types";
import { FakeWebexApi, WEBEX_BASE_URL } from "./fake-webex-api";
import { actionWebhookPayload, BOT, createHarness, messageWebhookPayload } from "./harness";
import {
  httpSteps,
  isMultipart,
  loadRecording,
  RECORDED_BOT_EMAIL,
  RECORDED_BOT_ID,
  RECORDED_ROOM_ID,
  type RecordedHttpStep,
  type RecordedObservationStep,
  type Recording,
  recordingNames,
  responseOf,
  webhookSteps,
} from "./recordings";

const TOKEN = "recorded-replay-token";
const RECORDED_ID = /rec-[a-z-]+?-(?:\d+|bot|space)/g;

interface MessageShape {
  hasCard: boolean;
  hasFiles: boolean;
  markdown?: string;
  parentId?: string;
  roomId?: string;
}

function shapeOf(message: WebexMessage): MessageShape {
  return {
    roomId: message.roomId,
    parentId: message.parentId,
    markdown: message.markdown,
    hasCard: (message.attachments?.length ?? 0) > 0,
    hasFiles: (message.files?.length ?? 0) > 0,
  };
}

/** Replays one recording against a fresh fake, step by step. */
async function replay(recording: Recording): Promise<void> {
  const api = new FakeWebexApi({
    bot: { id: RECORDED_BOT_ID, displayName: "Recorded bot", emails: [RECORDED_BOT_EMAIL], type: "bot" },
    token: TOKEN,
  });
  api.addRoom({ id: RECORDED_ROOM_ID, type: "group", title: "Recorded space" });

  // Recorded ID -> ID the fake assigned (messages the bot created during the replay).
  const ids = new Map<string, string>();
  const swap = (value: string) => value.replace(RECORDED_ID, (id) => ids.get(id) ?? id);

  for (const [index, step] of recording.steps.entries()) {
    if (step.type === "webhook") {
      // Things a person did in Webex: store them as the fake's starting state.
      const { data } = step.body;
      if (step.body.resource === "messages") {
        api.addMessage(responseOf<WebexMessage>(recording, "GET", `/messages/${String(data.id)}`));
      } else {
        api.addAttachmentAction(
          responseOf<WebexAttachmentAction>(recording, "GET", `/attachment/actions/${String(data.id)}`)
        );
      }
      continue;
    }
    if (step.type !== "http") {
      continue;
    }

    // A bot message from an earlier recording (e.g. a card posted before).
    const referenced = /^\/messages\/(rec-message-\d+)$/.exec(step.request.path)?.[1];
    if (referenced && !ids.has(referenced) && !api.messages.has(referenced)) {
      api.addMessage({ id: referenced, roomId: RECORDED_ROOM_ID, personId: RECORDED_BOT_ID, markdown: "seeded" });
    }

    const response = await api.fetch(`${WEBEX_BASE_URL}${swap(step.request.path)}`, requestInit(step, swap));
    const text = await response.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    const recorded = step.response.body as Record<string, unknown> | undefined;
    const label = `${recording.scenario} step ${index + 1}: ${step.request.method} ${step.request.path}`;

    expect(response.status, label).toBe(step.response.status);
    if (step.response.status >= 400) {
      expect(body?.message, label).toBe(recorded?.message);
      continue;
    }
    if (recorded?.id) {
      expect(body?.id, label).toEqual(expect.any(String));
      if (step.request.method === "POST") {
        ids.set(String(recorded.id), String(body?.id));
      }
      const expected = JSON.parse(swap(JSON.stringify(shapeOf(recorded as unknown as WebexMessage)))) as MessageShape;
      expect(shapeOf(body as unknown as WebexMessage), label).toEqual(expected);
    }
  }
}

function requestInit(step: RecordedHttpStep, swap: (value: string) => string): RequestInit {
  const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` };
  const { body, method } = step.request;
  if (body === undefined) {
    return { method, headers };
  }
  if (isMultipart(body)) {
    const form = new FormData();
    for (const [key, value] of Object.entries(body.fields)) {
      form.set(key, swap(value));
    }
    for (const file of body.files) {
      form.append(file.field, new Blob([new Uint8Array(file.size)], { type: file.type }), file.name);
    }
    return { method, headers, body: form };
  }
  headers["content-type"] = "application/json";
  return { method, headers, body: swap(JSON.stringify(body)) };
}

describe("fake Webex API matches the recorded real Webex behaviour", () => {
  it.each(recordingNames())("%s", async (name) => {
    await replay(loadRecording(name));
  });
});

describe("recorded Webex webhooks through the adapter", () => {
  const ROOM = "room-recorded";
  const PERSON = {
    id: "rec-people-2",
    displayName: "Recorded Person",
    emails: ["person-1@example.com"],
    type: "person" as const,
  };
  const substitutions = { [RECORDED_BOT_ID]: BOT.id, [RECORDED_BOT_EMAIL]: BOT.emails?.[0] ?? "", [RECORDED_ROOM_ID]: ROOM };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup() {
    const h = createHarness();
    h.api.addRoom({ id: ROOM, type: "group", title: "Recorded space" });
    h.api.addPerson(PERSON);
    return h;
  }

  it("dispatches a recorded mention", async () => {
    const recording = loadRecording("webhook-mention", substitutions);
    const [webhook] = webhookSteps(recording);
    const h = setup();
    h.api.addMessage(responseOf<WebexMessage>(recording, "GET", `/messages/${String(webhook?.body.data.id)}`));
    const mentions: Array<{ message: Message; thread: Thread }> = [];
    h.chat.onNewMention(async (thread, message) => {
      mentions.push({ thread, message });
    });

    const response = await h.sendWebhook(webhook?.body);

    expect(response.status).toBe(200);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.message.text).toContain("hello from the fixture recorder");
    expect(mentions[0]?.message.author).toMatchObject({ userId: PERSON.id, isMe: false });
  });

  it("dispatches a recorded card submit with its input", async () => {
    const recording = loadRecording("webhook-card-submit", substitutions);
    const [webhook] = webhookSteps(recording);
    const h = setup();
    h.api.addMessage(responseOf<WebexMessage>(recording, "POST", "/messages"));
    h.api.addAttachmentAction(
      responseOf<WebexAttachmentAction>(recording, "GET", `/attachment/actions/${String(webhook?.body.data.id)}`)
    );
    const actions: ActionEvent[] = [];
    h.chat.onAction("submit-note", async (event) => {
      actions.push(event);
    });

    await h.sendWebhook(webhook?.body);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ actionId: "submit-note", value: "fixture note", messageId: "rec-message-10" });
    expect(actions[0]?.user).toMatchObject({ userId: PERSON.id });
  });

  it("gets no submit from an edited card, but does from a replacement card (#9)", async () => {
    const recording = loadRecording("edited-card-submit", substitutions);
    const observation = recording.steps.find((step): step is RecordedObservationStep => step.type === "observation");
    expect(observation?.attachmentActionsWebhooks).toBe(0);

    const [webhook] = webhookSteps(recording);
    const h = setup();
    h.api.addMessage(responseOf<WebexMessage>(recording, "POST", "/messages"));
    h.api.addAttachmentAction(
      responseOf<WebexAttachmentAction>(recording, "GET", `/attachment/actions/${String(webhook?.body.data.id)}`)
    );
    const actions: ActionEvent[] = [];
    h.chat.onAction("submit-replacement", async (event) => {
      actions.push(event);
    });

    await h.sendWebhook(webhook?.body);

    expect(actions).toHaveLength(1);
    expect(actions[0]?.messageId).toBe(String(webhook?.body.data.messageId));
  });

  it("builds harness webhooks with the same data fields as real Webex", () => {
    const realMessage = webhookSteps(loadRecording("webhook-mention"))[0]?.body.data ?? {};
    const realAction = webhookSteps(loadRecording("webhook-card-submit"))[0]?.body.data ?? {};

    const message = messageWebhookPayload({
      id: "m",
      roomId: "r",
      roomType: "group",
      personId: "p",
      personEmail: "p@example.com",
      mentionedPeople: [BOT.id],
      created: "2026-01-01T00:00:00.000Z",
    });
    const action = actionWebhookPayload({ id: "a", type: "submit", messageId: "m", personId: "p", roomId: "r", created: "x" });

    expect(Object.keys(message.data).sort()).toEqual(Object.keys(realMessage).sort());
    expect(Object.keys(action.data).sort()).toEqual(Object.keys(realAction).sort());
  });

  it("substitutes whole placeholders only, and any value safely", () => {
    // rec-message-1 must not rewrite rec-message-10; quotes and backslashes must survive.
    const recording = loadRecording("edited-card-submit", { "rec-message-1": "wrong", "rec-message-10": 'a"b\\c' });
    const [put] = httpSteps(recording);
    expect(put?.request.path).toBe('/messages/a"b\\c');
    expect(JSON.stringify(recording)).not.toContain("wrong");
  });

  it("covers every recorded request in a replay", () => {
    const total = recordingNames().reduce((count, name) => count + httpSteps(loadRecording(name)).length, 0);
    expect(total).toBeGreaterThan(30);
  });
});
