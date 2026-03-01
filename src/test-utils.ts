import { createHmac, randomUUID } from "node:crypto";
import type { Lock, StateAdapter } from "chat";

interface StoredValue {
  expiresAt?: number;
  value: unknown;
}

export interface WaitUntilTracker {
  waitForAll: () => Promise<void>;
  waitUntil: (task: Promise<unknown>) => void;
}

export function createInMemoryStateAdapter(): StateAdapter {
  const store = new Map<string, StoredValue>();
  const subscriptions = new Set<string>();
  const locks = new Map<string, Lock>();

  const now = () => Date.now();

  const read = <T>(key: string): T | null => {
    const entry = store.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== undefined && entry.expiresAt <= now()) {
      store.delete(key);
      return null;
    }

    return entry.value as T;
  };

  return {
    connect: async () => {},
    disconnect: async () => {},
    get: async <T>(key: string) => read<T>(key),
    set: async <T>(key: string, value: T, ttlMs?: number) => {
      store.set(key, {
        value,
        expiresAt: typeof ttlMs === "number" ? now() + ttlMs : undefined,
      });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    subscribe: async (threadId: string) => {
      subscriptions.add(threadId);
    },
    unsubscribe: async (threadId: string) => {
      subscriptions.delete(threadId);
    },
    isSubscribed: async (threadId: string) => subscriptions.has(threadId),
    acquireLock: async (threadId: string, ttlMs: number) => {
      const existing = locks.get(threadId);
      if (existing && existing.expiresAt > now()) {
        return null;
      }

      const lock: Lock = {
        threadId,
        token: randomUUID(),
        expiresAt: now() + ttlMs,
      };
      locks.set(threadId, lock);
      return lock;
    },
    releaseLock: async (lock: Lock) => {
      const current = locks.get(lock.threadId);
      if (current?.token === lock.token) {
        locks.delete(lock.threadId);
      }
    },
    extendLock: async (lock: Lock, ttlMs: number) => {
      const current = locks.get(lock.threadId);
      if (!current || current.token !== lock.token) {
        return false;
      }
      current.expiresAt = now() + ttlMs;
      locks.set(lock.threadId, current);
      return true;
    },
  };
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
