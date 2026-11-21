/**
 * Loader for the real-Webex recordings in `fixtures/webex/`.
 *
 * The recordings come from `scripts/record-webex-fixtures.mjs`, which calls the
 * real Webex API and captures real webhooks. IDs are stable placeholders
 * (`rec-message-1`, `rec-people-bot`, `rec-room-space`, …) and emails are
 * `person-N@example.com` / `bot@webex.bot`, so a test can swap in its own
 * values with `substitutions`.
 */
import { readdirSync, readFileSync } from "node:fs";

const FIXTURE_DIR = new URL("./fixtures/webex/", import.meta.url);

/** Placeholders every recording uses for the bot and the space. */
export const RECORDED_BOT_ID = "rec-people-bot";
export const RECORDED_BOT_EMAIL = "bot@webex.bot";
export const RECORDED_ROOM_ID = "rec-room-space";

export interface RecordedHttpStep {
  type: "http";
  request: {
    method: string;
    path: string;
    body?: unknown;
  };
  response: {
    status: number;
    trackingId?: string;
    body?: unknown;
  };
}

export interface RecordedWebhookStep {
  type: "webhook";
  signatureValid: boolean;
  body: {
    resource: string;
    event: string;
    data: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface RecordedObservationStep {
  type: "observation";
  description: string;
  attachmentActionsWebhooks: number;
}

export type RecordedStep = RecordedHttpStep | RecordedWebhookStep | RecordedObservationStep;

export interface Recording {
  scenario: string;
  description: string;
  recordedAt: string;
  source: string;
  steps: RecordedStep[];
}

/** Multipart bodies are recorded as their fields plus file metadata. */
export interface RecordedMultipartBody {
  multipart: true;
  fields: Record<string, string>;
  files: Array<{ field: string; name: string; type: string; size: number }>;
}

export function recordingNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""))
    .sort();
}

/**
 * Loads a recording. `substitutions` replaces whole placeholders in every
 * string value (`rec-message-1` never matches inside `rec-message-10`).
 */
export function loadRecording(name: string, substitutions: Record<string, string> = {}): Recording {
  const recording = JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), "utf8")) as Recording;
  const keys = Object.keys(substitutions).sort((a, b) => b.length - a.length);
  if (keys.length === 0) {
    return recording;
  }
  const escaped = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const placeholder = new RegExp(`(?<![\\w.-])(?:${escaped.join("|")})(?![\\w-])`, "g");
  return substitute(recording, (value) => value.replace(placeholder, (match) => substitutions[match] ?? match));
}

function substitute<T>(value: T, replace: (text: string) => string): T {
  if (typeof value === "string") {
    return replace(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => substitute(item, replace)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, substitute(inner, replace)])
    ) as T;
  }
  return value;
}

export function httpSteps(recording: Recording): RecordedHttpStep[] {
  return recording.steps.filter((step): step is RecordedHttpStep => step.type === "http");
}

export function webhookSteps(recording: Recording): RecordedWebhookStep[] {
  return recording.steps.filter((step): step is RecordedWebhookStep => step.type === "webhook");
}

/** The recorded response of the first `method path` request. */
export function responseOf<T = Record<string, unknown>>(recording: Recording, method: string, path: string): T {
  const step = httpSteps(recording).find((candidate) => candidate.request.method === method && candidate.request.path === path);
  if (!step) {
    throw new Error(`${recording.scenario} has no ${method} ${path}`);
  }
  return step.response.body as T;
}

export function isMultipart(body: unknown): body is RecordedMultipartBody {
  return typeof body === "object" && body !== null && (body as { multipart?: unknown }).multipart === true;
}
