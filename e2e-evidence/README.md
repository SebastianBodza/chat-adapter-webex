# Real-Webex E2E evidence for issues #8–#11

Recorded on 2026-11-21 against the real Webex API (`webexapis.com`) and Webex Web (`web.webex.com`), using a test bot in a test space.

- `main` = `59d9ee9`.
- `pr23` = PR #23 (`fix/edit-message-room-id`).

Tokens are never recorded. Each fixture holds the request and response bodies plus the Webex `trackingId`. The human user's email and person ID are redacted.

## Contents

| File | What it shows |
| --- | --- |
| `run.mjs` | Runner that drives the adapter's `dist` build from a worktree. Usage: `node run.mjs <worktree> <label> api` (edit scenarios) or `node run.mjs <worktree> <label> modal <publicUrl>` (modal flow; needs webhooks, e.g. via ngrok). |
| `fixtures/main-api.json`, `fixtures/pr23-api.json` | #8: `editMessage` on main → `400 Invalid roomId`. The same edits on PR #23 → `200`. The control step is a raw `PUT` with `roomId` and a card → `200`. |
| `fixtures/main-modal.json`, `fixtures/pr23-modal.json` | #8 (modal path): on main, the modal `update` `PUT` sends only `markdown` and `attachments` → `400 Invalid roomId`. On PR #23 it sends `roomId` → `200`. |
| `raw-edit-limits.mjs`, `fixtures/raw-edit-limits.json` | Raw API, no adapter. Editing a message that has a file → `400 Unable to modify this type of message`. Edits 1–10 → `200`. Edit 11 → `400 Max allowed number of edits per activity reached`. |
| `raw-edit-submit.mjs`, `fixtures/raw-edit-submit.json` | #9, raw API, no adapter. Card A is posted and never edited. Card B is edited via `PUT` (`200`). Both submit buttons were clicked in Webex Web: only A delivered an `attachmentActions` webhook. |
| `screenshots/`, `recordings/` | Webex Web captures of the runs above (cropped to the conversation). |
| `local/issue10-*.txt` | #10: `tsc` with `src/**/*.test.ts` included. main → 13 errors; PR #25 → exit 0. |
| `local/issue11-*.txt` | #11: a consumer installs `chat@4.20.0` plus the packed adapter. main → a nested `chat@4.45.0` under `@chat-adapter/shared`; PR #26 → a single `chat@4.20.0`. |
