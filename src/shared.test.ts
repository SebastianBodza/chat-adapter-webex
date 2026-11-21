import {
  Card,
  CardLink,
  CardText,
  Chart,
  cardChildToFallbackText,
  Divider,
  Field,
  Fields,
  Section,
  Table,
  TextInput,
} from "chat";
import { describe, expect, it } from "vitest";
import {
  AdapterError,
  AdapterRateLimitError,
  AuthenticationError,
  cardToFallbackMarkdown,
  extractCard,
  extractFiles,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  toBuffer,
  ValidationError,
} from "./shared";

describe("error classes", () => {
  it("keep the names, codes and fields of @chat-adapter/shared", () => {
    const cases: Array<[AdapterError, string, string, string]> = [
      [new AdapterRateLimitError("webex", 30), "AdapterRateLimitError", "RATE_LIMITED", "Rate limited by webex, retry after 30s"],
      [new AdapterRateLimitError("webex"), "AdapterRateLimitError", "RATE_LIMITED", "Rate limited by webex"],
      [new AuthenticationError("webex"), "AuthenticationError", "AUTH_FAILED", "Authentication failed for webex"],
      [new ResourceNotFoundError("webex", "message", "m1"), "ResourceNotFoundError", "NOT_FOUND", "message 'm1' not found in webex"],
      [new ResourceNotFoundError("webex", "room"), "ResourceNotFoundError", "NOT_FOUND", "room not found in webex"],
      [new PermissionError("webex", "post", "spark:all"), "PermissionError", "PERMISSION_DENIED", "Permission denied: cannot post in webex (requires: spark:all)"],
      [new PermissionError("webex", "post"), "PermissionError", "PERMISSION_DENIED", "Permission denied: cannot post in webex"],
      [new ValidationError("webex", "bad"), "ValidationError", "VALIDATION_ERROR", "bad"],
      [new NetworkError("webex"), "NetworkError", "NETWORK_ERROR", "Network error communicating with webex"],
    ];
    for (const [error, name, code, message] of cases) {
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ name, code, message, adapter: "webex" });
    }
    expect(new AdapterRateLimitError("webex", 5).retryAfter).toBe(5);
    const cause = new Error("socket hang up");
    expect(new NetworkError("webex", "failed", cause).originalError).toBe(cause);
  });
});

describe("postable message helpers", () => {
  const card = Card({ title: "Hi" });

  it("extracts a card from a bare card or a { card } message", () => {
    expect(extractCard(card)).toBe(card);
    expect(extractCard({ card })).toBe(card);
    expect(extractCard("text")).toBeNull();
    expect(extractCard({ markdown: "x" })).toBeNull();
  });

  it("extracts file uploads", () => {
    const file = { filename: "a.txt", data: Buffer.from("a") };
    expect(extractFiles({ markdown: "x", files: [file] })).toEqual([file]);
    expect(extractFiles({ markdown: "x", files: undefined })).toEqual([]);
    expect(extractFiles("text")).toEqual([]);
  });

  it("converts Buffer, ArrayBuffer and Blob data, and rejects anything else", async () => {
    const bytes = [1, 2, 3];
    expect([...((await toBuffer(Buffer.from(bytes))) ?? [])]).toEqual(bytes);
    expect([...((await toBuffer(new Uint8Array(bytes).buffer)) ?? [])]).toEqual(bytes);
    expect([...((await toBuffer(new Blob([new Uint8Array(bytes)]))) ?? [])]).toEqual(bytes);
    expect(await toBuffer("nope" as unknown as Buffer)).toBeNull();
  });
});

describe("cardToFallbackMarkdown", () => {
  it("renders every card element with emoji converted", () => {
    const text = cardToFallbackMarkdown(
      Card({
        title: "Deploy {{emoji:rocket}}",
        subtitle: "prod {{emoji:fire}}",
        children: [
          CardText("Ready {{emoji:thumbs_up}}"),
          CardLink({ label: "Runbook", url: "https://example.com" }),
          Fields([Field({ label: "Env", value: "prod" })]),
          Section([CardText("nested")]),
          Divider(),
          TextInput({ id: "why", label: "Reason" }),
          Table({ headers: ["a"], rows: [["1"]] }),
        ],
      })
    );

    expect(text.split("\n\n")).toEqual([
      "**Deploy 🚀**",
      "prod 🔥",
      "Ready 👍",
      "Runbook (https://example.com)",
      "Env: prod",
      "nested",
      "---",
      "Reason",
      expect.stringContaining("a"),
    ]);
  });
});

describe("fallback parity with the current chat release", () => {
  it.each([
    ["table", Table({ headers: ["Service", "Status"], rows: [["api", "up"], ["worker-long-name", "degraded"], ["x"]] })],
    ["pie chart", Chart({ title: "Share", chart: { type: "pie", segments: [{ label: "A", value: 3 }, { label: "Bee", value: 10 }] } })],
    [
      "series chart",
      Chart({
        title: "Sales",
        chart: {
          type: "line",
          xLabel: "Week",
          categories: ["W1", "W2"],
          series: [{ name: "EU", data: [{ label: "W1", value: 5 }] }],
        },
      }),
    ],
  ])("renders a %s like chat's own cardChildToFallbackText", (_name, child) => {
    expect(cardToFallbackMarkdown(Card({ children: [child] }))).toBe(cardChildToFallbackText(child));
  });

  it("renders an empty table as nothing", () => {
    expect(cardToFallbackMarkdown(Card({ children: [Table({ headers: [], rows: [] })] }))).toBe("");
  });
});
