import { createHmac } from "node:crypto";
import { createMemoryState } from "@chat-adapter/state-memory";
import type { StateAdapter } from "chat";

export interface WaitUntilTracker {
  waitForAll: () => Promise<void>;
  waitUntil: (task: Promise<unknown>) => void;
}

/**
 * In-memory Chat state for tests. Delegates to the official
 * `@chat-adapter/state-memory` package so it always implements the full
 * `StateAdapter` contract of the installed `chat` version.
 */
export function createInMemoryStateAdapter(): StateAdapter {
  return createMemoryState();
}

export function createSparkSignature(body: string, secret: string): string {
  return createHmac("sha1", secret).update(body).digest("hex");
}

export function createSignedWebhookRequest(
  payload: unknown,
  secret: string
): Request {
  const body = JSON.stringify(payload);
  return new Request("https://example.com/webhooks/webex", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spark-signature": createSparkSignature(body, secret),
    },
    body,
  });
}

export function createWaitUntilTracker(): WaitUntilTracker {
  const tasks: Promise<unknown>[] = [];

  return {
    waitUntil: (task) => {
      tasks.push(task);
    },
    waitForAll: async () => {
      while (tasks.length > 0) {
        const pending = tasks.splice(0, tasks.length);
        await Promise.allSettled(pending);
      }
    },
  };
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
