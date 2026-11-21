// Raw Webex API check (no adapter): file-message edits and the 10-edit limit.
import { writeFileSync } from "node:fs";
const { WEBEX_BOT_TOKEN: token, WEBEX_ROOM_ID: roomId } = process.env;
const out = [];
const call = async (label, path, method, body, form) => {
  const r = await fetch(`https://webexapis.com/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(form ? {} : { "content-type": "application/json" }) }, body: form ?? (body && JSON.stringify(body)) });
  const json = await r.json().catch(() => null);
  out.push({ label, request: { method, path, body: form ? "<multipart: markdown + files=e2e-file.txt>" : body }, response: { status: r.status, trackingId: r.headers.get("trackingid"), message: json?.message, errors: json?.errors } });
  console.log(r.status, label, json?.message ?? "");
  return json;
};
const fd = new FormData();
fd.append("roomId", roomId); fd.append("markdown", "[raw] message with a file");
fd.append("files", new Blob(["hello e2e"], { type: "text/plain" }), "e2e-file.txt");
const file = await call("POST message with a file", "/messages", "POST", null, fd);
await call("PUT text edit of the file message (with roomId)", `/messages/${file.id}`, "PUT", { roomId, markdown: "[raw] edited file message" });
const t = await call("POST text message", "/messages", "POST", { roomId, markdown: "[raw] edit limit: v0" });
for (let i = 1; i <= 11; i++) await call(`PUT edit #${i}`, `/messages/${t.id}`, "PUT", { roomId, markdown: `[raw] edit limit: v${i}` });
writeFileSync("fixtures/raw-edit-limits.json", JSON.stringify(out, null, 2));
