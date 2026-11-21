// Real-Webex end-to-end runner for chat-adapter-webex.
//
//   node run.mjs <worktree> <label> api          # #8 / #9 edit scenarios (no webhooks)
//   node run.mjs <worktree> <label> modal <url>  # #9 modal update, needs a public URL (ngrok)
//
// Env: WEBEX_BOT_TOKEN, WEBEX_ROOM_ID. Imports the adapter from <worktree>/dist
// and chat from <worktree>/node_modules, so each branch runs its own build.
// Every Webex request/response is recorded to fixtures/<label>-<mode>.json
// (Authorization header never recorded).
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [worktree, label, mode, publicUrl] = process.argv.slice(2);
const { WEBEX_BOT_TOKEN: token, WEBEX_ROOM_ID: roomId } = process.env;
if (!worktree || !label || !mode || !token || !roomId) {
  console.error("usage: node run.mjs <worktree> <label> <api|modal> [publicUrl]");
  process.exit(2);
}
const load = (p) => import(pathToFileURL(join(worktree, p)).href);
const { createWebexAdapter } = await load("dist/index.js");
const { Chat, Card, CardText, Actions, Button, Modal, TextInput } = await load("node_modules/chat/dist/index.js");
const { createMemoryState } = await load("node_modules/@chat-adapter/state-memory/dist/index.js");

// --- fixture recording -------------------------------------------------------
const exchanges = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = init.method ?? input.method ?? "GET";
  let requestBody;
  if (typeof init.body === "string") {
    try { requestBody = JSON.parse(init.body); } catch { requestBody = init.body; }
  }
  const response = await realFetch(input, init);
  const text = await response.clone().text();
  let responseBody;
  try { responseBody = JSON.parse(text); } catch { responseBody = text || undefined; }
  if (url.startsWith("https://webexapis.com")) {
    exchanges.push({
      at: new Date().toISOString(),
      request: { method, path: url.replace("https://webexapis.com/v1", ""), body: requestBody },
      response: { status: response.status, trackingId: response.headers.get("trackingid"), body: responseBody },
    });
  }
  return response;
};
const results = [];
const step = async (name, fn) => {
  try {
    const value = await fn();
    results.push({ step: name, ok: true, value });
    console.log(`✔ ${name}`, value ?? "");
    return value;
  } catch (error) {
    results.push({ step: name, ok: false, error: `${error.name}: ${error.message}` });
    console.log(`✘ ${name} → ${error.name}: ${error.message}`);
    return undefined;
  }
};
const save = () => {
  mkdirSync("fixtures", { recursive: true });
  const file = `fixtures/${label}-${mode}.json`;
  writeFileSync(file, JSON.stringify({ label, mode, worktree: worktree.split("/").pop(), results, exchanges }, null, 2));
  console.log(`fixture → ${file}`);
};

const logs = [];
const logger = {
  debug() {},
  info() {},
  warn: (message, meta) => logs.push({ level: "warn", message, meta: String(meta?.error ?? "") }),
  error: (message, meta) => logs.push({ level: "error", message, meta: String(meta?.error ?? meta ?? "") }),
  child() { return logger; },
};
const webhookSecret = randomBytes(16).toString("hex");
const adapter = createWebexAdapter({ botToken: token, webhookSecret, logger });
const chat = new Chat({ userName: "chatadapterwebexe2e", adapters: { webex: adapter }, state: createMemoryState(), logger: "silent" });
await chat.initialize();
const getMessage = async (id) => {
  const r = await realFetch(`https://webexapis.com/v1/messages/${id}`, { headers: { authorization: `Bearer ${token}` } });
  const m = await r.json();
  return { text: m.text, markdown: m.markdown, hasCard: Boolean(m.attachments?.length), updated: m.updated ?? null };
};

if (mode === "api") {
  const channelId = adapter.channelIdFromThreadId(adapter.encodeThreadId({ roomId, rootMessageId: "x" }));
  const root = await adapter.postChannelMessage(channelId, `**[${label}]** E2E run ${new Date().toISOString()}: edit scenarios for #8 / #9`);
  const threadId = adapter.encodeThreadId({ roomId, rootMessageId: root.id });

  // #8: plain text edit
  const text = await adapter.postMessage(threadId, `[${label}] #8: original text`);
  await step("#8 editMessage(text)", async () => (await adapter.editMessage(threadId, text.id, `[${label}] #8: EDITED text ✅`)).id);
  await step("#8 message after edit (GET)", () => getMessage(text.id));

  // #9a: edit a text message into a card
  const toCard = await adapter.postMessage(threadId, `[${label}] #9: text that should become a card`);
  await step("#9 editMessage(card)", async () =>
    (await adapter.editMessage(threadId, toCard.id, Card({ title: `[${label}] #9 edited into a card`, children: [CardText("If you see this card, the edit worked.")] }))).id);
  await step("#9 message after card edit (GET)", () => getMessage(toCard.id));

  // #9 control: what Webex says about a correct PUT (with roomId) that carries attachments
  const control = await adapter.postMessage(threadId, `[${label}] control: raw PUT with roomId + card (bypasses the adapter)`);
  await step("#9 control: raw PUT with roomId + attachments", async () => {
    const r = await fetch(`https://webexapis.com/v1/messages/${control.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ roomId, markdown: "control card", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", version: "1.3", body: [{ type: "TextBlock", text: "Control: Webex accepted adding this card via PUT", weight: "Bolder" }] } }] }),
    });
    return { status: r.status, body: await r.json() };
  });

  // #9b: text edit of a message that already has a card
  const card = await adapter.postMessage(threadId, Card({ title: `[${label}] #9: card message`, children: [CardText("original card")] }));
  await step("#9 editMessage(text) on a card message", async () => (await adapter.editMessage(threadId, card.id, `[${label}] card replaced by text`)).id);
  save();
  process.exit(0);
}

if (mode === "modal") {
  if (!publicUrl) throw new Error("modal mode needs the public URL");
  const submits = [];
  chat.onAction("report", async (event) => {
    await event.openModal(Modal({
      callbackId: "incident",
      title: `[${label}] Step 1: incident report`,
      submitLabel: "Next",
      children: [TextInput({ id: "summary", label: "Summary" })],
    }));
  });
  chat.onModalSubmit("incident", async (event) => {
    submits.push({ viewId: event.viewId, values: event.values });
    console.log("modal submit", event.values);
    if (submits.length === 1) {
      return { action: "update", modal: Modal({ callbackId: "incident", title: `[${label}] Step 2: confirm "${event.values.summary}"`, submitLabel: "Confirm", children: [TextInput({ id: "note", label: "Anything else?", optional: true })] }) };
    }
    await event.relatedThread?.post(`[${label}] ✅ Modal finished after ${submits.length} steps.`);
    return undefined;
  });

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`${publicUrl}${req.url}`, { method: req.method, headers: req.headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined });
    const response = await chat.webhooks.webex(request, { waitUntil: (p) => p.catch(() => {}) });
    res.writeHead(response.status).end(await response.text());
  }).listen(8787);

  const hooks = [];
  for (const resource of ["attachmentActions", "messages"]) {
    const r = await realFetch("https://webexapis.com/v1/webhooks", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: `e2e-${label}-${resource}`, targetUrl: `${publicUrl}/api/webhooks/webex`, resource, event: "created", filter: `roomId=${roomId}`, secret: webhookSecret }),
    });
    hooks.push((await r.json()).id);
  }
  const channelId = adapter.channelIdFromThreadId(adapter.encodeThreadId({ roomId, rootMessageId: "x" }));
  const root = await adapter.postChannelMessage(channelId, Card({
    title: `[${label}] #9 modal update E2E`,
    children: [CardText("Click the button, fill in the form and press Next. Step 2 should replace the form."), Actions([Button({ id: "report", label: "Report incident" })])],
  }));
  console.log("posted card", root.id, "— waiting for clicks (5 min)");

  const done = new Promise((resolve) => {
    const t = setInterval(() => { if (submits.length >= 2 || (submits.length === 1 && logs.length)) { clearInterval(t); setTimeout(resolve, 4000); } }, 500);
    setTimeout(resolve, 5 * 60_000);
  });
  await done;
  results.push({ step: "modal submits", value: submits }, { step: "adapter error logs", value: logs });
  for (const id of hooks) await realFetch(`https://webexapis.com/v1/webhooks/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  server.close();
  save();
  console.log("errors:", JSON.stringify(logs));
  process.exit(0);
}
