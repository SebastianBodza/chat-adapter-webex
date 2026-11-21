#!/usr/bin/env node
/**
 * Records real Webex API behaviour into replayable fixtures for the
 * integration tests (test/integration/fixtures/webex/*.json).
 *
 * The scenarios call the Webex REST API directly (not through the adapter), so
 * the fixtures describe Webex itself. `webex-recorded.test.ts` replays them
 * against the fake API and feeds the recorded webhooks through the adapter.
 *
 *   WEBEX_BOT_TOKEN=… WEBEX_ROOM_ID=… node scripts/record-webex-fixtures.mjs
 *   WEBEX_BOT_TOKEN=… WEBEX_ROOM_ID=… node scripts/record-webex-fixtures.mjs --webhooks https://<public-url> [--port 8787]
 *
 * - WEBEX_ROOM_ID: a group space with the bot and one human member.
 * - --webhooks: also records the interactive scenarios. It needs a public URL
 *   that forwards to --port (for example `ngrok http 8787`), and a person in the
 *   space who follows the prompts (mention the bot, click card buttons).
 *
 * Fixtures never contain the token or the webhook secret. Webex IDs become
 * stable placeholders (`rec-message-1`, `rec-people-bot`, …), and email
 * addresses become `person-N@example.com` / `bot@webex.bot`.
 */
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://webexapis.com/v1";
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../test/integration/fixtures/webex");
const token = process.env.WEBEX_BOT_TOKEN;
const roomId = process.env.WEBEX_ROOM_ID;
const args = process.argv.slice(2);
const publicUrl = args.includes("--webhooks") ? args[args.indexOf("--webhooks") + 1] : undefined;
const port = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : 8787);
if (!token || !roomId) {
  console.error("Set WEBEX_BOT_TOKEN and WEBEX_ROOM_ID.");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Sanitizing
// ---------------------------------------------------------------------------

const WEBEX_ID = /Y2lzY29zcGFyazovL[A-Za-z0-9+/_-]+=*/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const idNames = new Map(); // "TYPE/uuid" -> placeholder
const idCounters = new Map();
const emailNames = new Map();
let botEmail;

function idKey(encoded) {
  const decoded = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const parts = decoded.split("/");
  // e.g. ciscospark://us/MESSAGE/<uuid>; file content IDs have no type segment.
  const segment = parts.at(-2) ?? "";
  const type = /^[A-Z_]+$/.test(segment) ? segment : "CONTENT";
  return { key: `${type}/${parts.at(-1)}`, type };
}

function nameId(encoded, preset) {
  const { key, type } = idKey(encoded);
  if (!idNames.has(key)) {
    const kind = type.toLowerCase().replace(/_/g, "-");
    const n = (idCounters.get(kind) ?? 0) + 1;
    idCounters.set(kind, n);
    idNames.set(key, preset ?? `rec-${kind}-${n}`);
  }
  return idNames.get(key);
}

function nameEmail(email) {
  if (email === botEmail) return "bot@webex.bot";
  if (!emailNames.has(email)) emailNames.set(email, `person-${emailNames.size + 1}@example.com`);
  return emailNames.get(email);
}

function sanitizeString(value) {
  let out = value.replace(WEBEX_ID, (match) => nameId(match));
  if (publicUrl) out = out.split(publicUrl).join("https://bot.example.com");
  return out.replace(EMAIL, (match) => nameEmail(match));
}

function sanitize(value) {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, sanitize(inner)]));
  }
  return value;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

let steps = [];

async function http(method, path, body) {
  const isForm = body instanceof FormData;
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(isForm || !body ? {} : { "content-type": "application/json" }) },
    body: isForm ? body : body && JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  let recordedBody = body;
  if (isForm) {
    const fields = {};
    const files = [];
    for (const [key, value] of body.entries()) {
      if (typeof value === "string") fields[key] = value;
      else files.push({ field: key, name: value.name, type: value.type, size: value.size });
    }
    recordedBody = { multipart: true, fields, files };
  }
  steps.push({
    type: "http",
    request: { method, path, body: recordedBody },
    response: { status: response.status, trackingId: response.headers.get("trackingid") ?? undefined, body: parsed },
  });
  console.log(`  ${method} ${path.slice(0, 60)} → ${response.status}${parsed?.message ? ` ${parsed.message}` : ""}`);
  return { status: response.status, body: parsed };
}

function save(name, description) {
  mkdirSync(OUT_DIR, { recursive: true });
  const fixture = sanitize({
    scenario: name,
    description,
    recordedAt: new Date().toISOString(),
    source: "Real Webex (webexapis.com), recorded by scripts/record-webex-fixtures.mjs",
    steps,
  });
  writeFileSync(join(OUT_DIR, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`✔ ${name}.json`);
  steps = [];
}

const card = (title, actionId, inputs = true) => [
  {
    contentType: "application/vnd.microsoft.card.adaptive",
    content: {
      type: "AdaptiveCard",
      version: "1.3",
      body: [
        { type: "TextBlock", text: title, weight: "Bolder", wrap: true },
        ...(inputs ? [{ type: "Input.Text", id: "note", label: "Note" }] : []),
      ],
      actions: [{ type: "Action.Submit", title: "Send", data: { actionId } }],
    },
  },
];
const text = (markdown) => ({ roomId, markdown });

// ---------------------------------------------------------------------------
// REST scenarios
// ---------------------------------------------------------------------------

const me = await fetch(`${API}/people/me`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
botEmail = me.emails?.[0];
nameId(me.id, "rec-people-bot");
nameId(roomId, "rec-room-space");
const label = `[fixtures ${new Date().toISOString().slice(0, 16)}]`;

console.log("edit-without-room-id");
{
  const m = await http("POST", "/messages", text(`${label} edit without roomId`));
  await http("PUT", `/messages/${m.body.id}`, { markdown: `${label} edited without roomId` });
  await http("PUT", `/messages/${m.body.id}`, { roomId, markdown: `${label} edited with roomId` });
  await http("GET", `/messages/${m.body.id}`);
  save("edit-without-room-id", "PUT /messages/{id} needs roomId: without it Webex answers 400 Invalid roomId (#8).");
}

console.log("edit-text-and-card");
{
  const m = await http("POST", "/messages", text(`${label} text that becomes a card`));
  await http("PUT", `/messages/${m.body.id}`, { roomId, markdown: `${label} now a card`, attachments: card(`${label} edited into a card`, "noop", false) });
  await http("GET", `/messages/${m.body.id}`);
  await http("PUT", `/messages/${m.body.id}`, { roomId, markdown: `${label} back to text` });
  await http("GET", `/messages/${m.body.id}`);
  save("edit-text-and-card", "Adaptive Card edits work once roomId is sent: text → card → text. Omitting attachments removes the card (#9).");
}

console.log("edit-missing-markdown");
{
  const m = await http("POST", "/messages", text(`${label} edit without text`));
  await http("PUT", `/messages/${m.body.id}`, { roomId });
  save("edit-missing-markdown", "An edit without text or markdown is rejected.");
}

console.log("edit-wrong-room-id");
{
  const m = await http("POST", "/messages", text(`${label} edit with another roomId`));
  const otherRoom = Buffer.from("ciscospark://us/ROOM/00000000-0000-4000-8000-000000000000").toString("base64").replace(/=+$/, "");
  await http("PUT", `/messages/${m.body.id}`, { roomId: otherRoom, markdown: `${label} edited` });
  save("edit-wrong-room-id", "An edit whose roomId is not the message's room is rejected.");
}

console.log("edit-file-message");
{
  const form = new FormData();
  form.set("roomId", roomId);
  form.set("markdown", `${label} message with a file`);
  form.set("files", new Blob(["fixture file"], { type: "text/plain" }), "fixture.txt");
  const m = await http("POST", "/messages", form);
  await http("PUT", `/messages/${m.body.id}`, { roomId, markdown: `${label} edited file message` });
  save("edit-file-message", "Messages with files can't be edited (#9).");
}

console.log("edit-limit");
{
  const m = await http("POST", "/messages", text(`${label} edit limit v0`));
  for (let i = 1; i <= 11; i++) await http("PUT", `/messages/${m.body.id}`, { roomId, markdown: `${label} edit limit v${i}` });
  save("edit-limit", "Webex allows 10 edits per message; the 11th is rejected (#8).");
}

console.log("reply-to-unknown-parent");
{
  const missing = Buffer.from("ciscospark://us/MESSAGE/00000000-0000-4000-8000-000000000000").toString("base64").replace(/=+$/, "");
  await http("POST", "/messages", { roomId, parentId: missing, markdown: `${label} reply` });
  save("reply-to-unknown-parent", "Replying to a message that does not exist is rejected.");
}

console.log("delete-message");
{
  const m = await http("POST", "/messages", text(`${label} to be deleted`));
  await http("DELETE", `/messages/${m.body.id}`);
  await http("GET", `/messages/${m.body.id}`);
  save("delete-message", "Deleting a message, then reading it.");
}

// ---------------------------------------------------------------------------
// Interactive webhook scenarios
// ---------------------------------------------------------------------------

if (publicUrl) {
  const secret = randomBytes(16).toString("hex");
  const waiters = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.end("ok");
    const signature = String(req.headers["x-spark-signature"] ?? "");
    const signatureValid = signature === createHmac("sha1", secret).update(raw).digest("hex");
    const body = JSON.parse(raw || "{}");
    for (const waiter of [...waiters]) {
      if (waiter.match(body)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve({ body, signatureValid });
      }
    }
  }).listen(port);
  const waitFor = (match, ms) =>
    new Promise((resolve) => {
      const waiter = { match, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        if (waiters.includes(waiter)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          resolve(undefined);
        }
      }, ms);
    });
  const recordWebhook = ({ body, signatureValid }) =>
    steps.push({ type: "webhook", signed: true, signatureValid, headers: { "content-type": "application/json" }, body });

  const hooks = [];
  for (const resource of ["messages", "attachmentActions"]) {
    const r = await fetch(`${API}/webhooks`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: `fixtures-${resource}`, targetUrl: `${publicUrl}/api/webhooks/webex`, resource, event: "created", filter: `roomId=${roomId}`, secret }),
    }).then((x) => x.json());
    hooks.push(r.id);
  }

  try {
    console.log(`\nwebhook-mention: mention the bot in the space, e.g. "@${me.displayName} hello"`);
    {
      const hook = await waitFor((b) => b.resource === "messages" && b.data?.personId !== me.id, 180_000);
      if (!hook) throw new Error("no mention received");
      recordWebhook(hook);
      await http("GET", `/messages/${hook.body.data.id}`);
      await http("PUT", `/messages/${hook.body.data.id}`, { roomId, markdown: "edited by the bot" });
      save("webhook-mention", "A person mentions the bot: messages/created webhook, the message, and the bot trying to edit it.");
    }

    console.log("\nwebhook-card-submit: type a note into the card and press Send");
    let cardMessage;
    {
      cardMessage = await http("POST", "/messages", { roomId, markdown: "fixture card", attachments: card(`${label} type a note and press Send`, "submit-note") });
      const hook = await waitFor((b) => b.resource === "attachmentActions", 180_000);
      if (!hook) throw new Error("no card submit received");
      recordWebhook(hook);
      await http("GET", `/attachment/actions/${hook.body.data.id}`);
      save("webhook-card-submit", "A person submits an Adaptive Card: attachmentActions/created webhook and the action.");
    }

    console.log("\nedited-card-submit: the card was edited. Press Send on the EDITED card (waiting 60 s)");
    {
      await http("PUT", `/messages/${cardMessage.body.id}`, { roomId, markdown: "fixture card (edited)", attachments: card(`${label} EDITED card: press Send`, "submit-edited") });
      const hook = await waitFor((b) => b.resource === "attachmentActions", 60_000);
      if (hook) recordWebhook(hook);
      steps.push({
        type: "observation",
        description: "Send was pressed on the edited card in Webex Web.",
        attachmentActionsWebhooks: hook ? 1 : 0,
      });
      console.log("\n  now press Send on the NEW card (replacement posted, old card deleted)");
      const replacement = await http("POST", "/messages", { roomId, markdown: "fixture card (replacement)", attachments: card(`${label} replacement card: press Send`, "submit-replacement") });
      await http("DELETE", `/messages/${cardMessage.body.id}`);
      const second = await waitFor((b) => b.resource === "attachmentActions" && b.data?.messageId === replacement.body.id, 180_000);
      if (second) {
        recordWebhook(second);
        await http("GET", `/attachment/actions/${second.body.data.id}`);
      }
      save("edited-card-submit", "Webex Web sends no submit from a card edited via PUT; a replacement card (post new, delete old) works (#9).");
    }
  } finally {
    for (const id of hooks) await fetch(`${API}/webhooks/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    server.close();
  }
}
