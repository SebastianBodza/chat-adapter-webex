/**
 * Helpers and error classes this adapter used to import from
 * `@chat-adapter/shared` (MIT, https://github.com/vercel/chat).
 *
 * They are inlined because every `@chat-adapter/shared` release depends on an
 * exact `chat` version, so a consumer on any other `chat` version got a second,
 * nested copy of `chat`. Runtime imports from `chat` are limited to APIs that
 * exist in the lowest supported peer version (see `peerDependencies.chat`);
 * the compat workflow checks this.
 * See https://github.com/SebastianBodza/chat-adapter-webex/issues/11.
 */
import {
  type AdapterPostableMessage,
  type CardChild,
  type CardElement,
  type ChartElement,
  convertEmojiPlaceholders,
  type FileUpload,
  isCardElement,
} from "chat";

// ---------------------------------------------------------------------------
// Errors (same names, codes and fields as @chat-adapter/shared)
// ---------------------------------------------------------------------------

/** Base class for errors raised by this adapter. Check `code` to branch on the kind. */
export class AdapterError extends Error {
  readonly adapter: string;
  readonly code?: string;

  constructor(message: string, adapter: string, code?: string) {
    super(message);
    this.name = "AdapterError";
    this.adapter = adapter;
    this.code = code;
  }
}

/** The platform rate-limited the request (`code: "RATE_LIMITED"`). */
export class AdapterRateLimitError extends AdapterError {
  readonly retryAfter?: number;

  constructor(adapter: string, retryAfter?: number) {
    super(
      `Rate limited by ${adapter}${retryAfter ? `, retry after ${retryAfter}s` : ""}`,
      adapter,
      "RATE_LIMITED"
    );
    this.name = "AdapterRateLimitError";
    this.retryAfter = retryAfter;
  }
}

/** The bot token was rejected (`code: "AUTH_FAILED"`). */
export class AuthenticationError extends AdapterError {
  constructor(adapter: string, message?: string) {
    super(message || `Authentication failed for ${adapter}`, adapter, "AUTH_FAILED");
    this.name = "AuthenticationError";
  }
}

/** The requested resource does not exist (`code: "NOT_FOUND"`). */
export class ResourceNotFoundError extends AdapterError {
  readonly resourceType: string;
  readonly resourceId?: string;

  constructor(adapter: string, resourceType: string, resourceId?: string) {
    const idPart = resourceId ? ` '${resourceId}'` : "";
    super(`${resourceType}${idPart} not found in ${adapter}`, adapter, "NOT_FOUND");
    this.name = "ResourceNotFoundError";
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}

/** The bot may not perform the action (`code: "PERMISSION_DENIED"`). */
export class PermissionError extends AdapterError {
  readonly action: string;
  readonly requiredScope?: string;

  constructor(adapter: string, action: string, requiredScope?: string) {
    const scopePart = requiredScope ? ` (requires: ${requiredScope})` : "";
    super(
      `Permission denied: cannot ${action} in ${adapter}${scopePart}`,
      adapter,
      "PERMISSION_DENIED"
    );
    this.name = "PermissionError";
    this.action = action;
    this.requiredScope = requiredScope;
  }
}

/** Invalid input, or a request the platform does not support (`code: "VALIDATION_ERROR"`). */
export class ValidationError extends AdapterError {
  constructor(adapter: string, message: string) {
    super(message, adapter, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

/** Any other failed platform request (`code: "NETWORK_ERROR"`). */
export class NetworkError extends AdapterError {
  readonly originalError?: Error;

  constructor(adapter: string, message?: string, originalError?: Error) {
    super(message || `Network error communicating with ${adapter}`, adapter, "NETWORK_ERROR");
    this.name = "NetworkError";
    this.originalError = originalError;
  }
}

// ---------------------------------------------------------------------------
// Postable message helpers
// ---------------------------------------------------------------------------

/** The card in a postable message, if it is one or carries one. */
export function extractCard(message: AdapterPostableMessage): CardElement | null {
  if (isCardElement(message)) {
    return message;
  }
  if (typeof message === "object" && message !== null && "card" in message) {
    return message.card as CardElement;
  }
  return null;
}

/** The file uploads in a postable message. */
export function extractFiles(message: AdapterPostableMessage): FileUpload[] {
  if (typeof message === "object" && message !== null && "files" in message) {
    return (message.files as FileUpload[] | undefined) ?? [];
  }
  return [];
}

/** File upload data as a Buffer, or `null` for unsupported data types. */
export async function toBuffer(data: FileUpload["data"]): Promise<Buffer | null> {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  return null;
}

// ---------------------------------------------------------------------------
// Emoji and card fallback text
// ---------------------------------------------------------------------------

/**
 * Converts `{{emoji:name}}` placeholders to Unicode. Webex renders Unicode
 * emoji, which is what the "gchat" mapping produces.
 */
export function convertEmoji(text: string): string {
  return convertEmojiPlaceholders(text, "gchat");
}

/** Plain-text/markdown rendering of a card, for clients that can't show Adaptive Cards. */
export function cardToFallbackMarkdown(card: CardElement): string {
  const parts: string[] = [];
  if (card.title) {
    parts.push(`**${convertEmoji(card.title)}**`);
  }
  if (card.subtitle) {
    parts.push(convertEmoji(card.subtitle));
  }
  for (const child of card.children) {
    const text = childToFallbackText(child);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join("\n\n");
}

function childToFallbackText(child: CardChild): string | null {
  switch (child.type) {
    case "text":
      return convertEmoji(child.content);
    case "link":
      return `${convertEmoji(child.label)} (${child.url})`;
    case "fields":
      return child.children
        .map((field) => `${convertEmoji(field.label)}: ${convertEmoji(field.value)}`)
        .join("\n");
    case "actions":
      return null;
    case "section":
      return child.children.map(childToFallbackText).filter(Boolean).join("\n");
    case "divider":
      return "---";
    case "text_input":
      return convertEmoji(child.label);
    case "table":
      return tableToAscii(child.headers, child.rows);
    case "chart":
      return chartToFallbackText(child);
    default:
      return null;
  }
}

/** Same layout as chat's `tableElementToAscii` (not exported by older `chat` versions). */
function tableToAscii(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const colCount = Math.max(...allRows.map((row) => row.length));
  if (colCount === 0) {
    return "";
  }
  const colWidths = Array.from({ length: colCount }, (_, i) =>
    Math.max(...allRows.map((row) => (row[i] ?? "").length))
  );
  const formatRow = (cells: string[]) =>
    colWidths.map((width, i) => (cells[i] ?? "").padEnd(width)).join(" | ").trimEnd();
  return [
    formatRow(headers),
    colWidths.map((width) => "-".repeat(width)).join("-|-"),
    ...rows.map(formatRow),
  ].join("\n");
}

function chartToFallbackText({ chart, title }: ChartElement): string {
  if (chart.type === "pie") {
    const segments = chart.segments.map((segment) => [segment.label, String(segment.value)]);
    return `${title}\n${tableToAscii(["Label", "Value"], segments)}`;
  }
  const headers = [chart.xLabel ?? "", ...chart.series.map((series) => series.name)];
  const rows = chart.categories.map((category) => [
    category,
    ...chart.series.map((series) => {
      const point = series.data.find((p) => p.label === category);
      return point ? String(point.value) : "";
    }),
  ]);
  return `${title}\n${tableToAscii(headers, rows)}`;
}
