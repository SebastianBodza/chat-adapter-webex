// Raw Webex API check (no adapter): does a card that was edited via PUT still send Action.Submit?
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
const { WEBEX_BOT_TOKEN: token, WEBEX_ROOM_ID: roomId } = process.env;
const publicUrl = process.argv[2];
const api = (path, method = "GET", body) => fetch(`https://webexapis.com/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const card = (title, id) => [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", version: "1.3", body: [{ type: "TextBlock", text: title, weight: "Bolder" }, { type: "Input.Text", id: "note", label: "Note" }], actions: [{ type: "Action.Submit", title: `Submit ${id}`, data: { which: id } }] } }];
const log = [];
const deliveries = [];
createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  const ev = JSON.parse(b || "{}");
  if (ev.resource === "attachmentActions") {
    const a = await api(`/attachment/actions/${ev.data.id}`);
    deliveries.push({ at: new Date().toISOString(), messageId: a.body.messageId, inputs: a.body.inputs });
    console.log("ACTION", JSON.stringify(a.body.inputs));
  }
  res.end("ok");
}).listen(8787);
const hook = await api("/webhooks", "POST", { name: "raw-edit-submit", targetUrl: `${publicUrl}/hook`, resource: "attachmentActions", event: "created", filter: `roomId=${roomId}` });
const a = await api("/messages", "POST", { roomId, markdown: "raw A", attachments: card("[raw] A: never edited", "A") });
const b = await api("/messages", "POST", { roomId, markdown: "raw B", attachments: card("[raw] B: before edit", "B-old") });
const put = await api(`/messages/${b.body.id}`, "PUT", { roomId, markdown: "raw B edited", attachments: card("[raw] B: edited via PUT", "B-edited") });
log.push({ postA: a.status, postB: b.status, putB: put.status, putBody: put.body?.message });
console.log("ready", JSON.stringify(log));
await new Promise((r) => setTimeout(r, 150_000));
await api(`/webhooks/${hook.body.id}`, "DELETE");
writeFileSync("fixtures/raw-edit-submit.json", JSON.stringify({ setup: log, deliveries, messageA: a.body.id, messageB: b.body.id }, null, 2));
console.log("done", JSON.stringify(deliveries));
process.exit(0);
