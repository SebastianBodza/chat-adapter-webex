/**
 * Stateful in-memory fake of the parts of the Webex REST API that the adapter
 * talks to. It is installed as the global `fetch`, so the adapter runs its
 * real HTTP code paths (URL building, headers, JSON/FormData bodies, error
 * mapping) without any network access.
 *
 * Behaviour mirrors the real API where it matters for the adapter:
 * - `GET /messages` lists newest-first and pages with `beforeMessage`.
 * - Bots listing a group space without `mentionedPeople=me` get a 403.
 * - `POST /messages` with `toPersonId` creates (or reuses) a direct room.
 * - Messages accept either JSON or multipart (`files`) bodies.
 * - Edits follow what the real API does (verified against webexapis.com in
 *   November 2026, see issues #8 and #9): `roomId` + `text`/`markdown` are
 *   required ("Invalid roomId" otherwise), only the author can edit, a message
 *   can be edited at most 10 times, and messages with *files* can't be edited.
 *   Contrary to the docs, Adaptive Card attachments *can* be edited: the PUT
 *   body's `attachments` replace the message's (omitting them removes the card).
 *   https://developer.webex.com/messaging/docs/api/v1/messages/edit-a-message
 * - Error statuses and messages are the ones real Webex returns. They are
 *   checked against the recordings in `fixtures/webex/` by
 *   `webex-recorded.test.ts`.
 */
import type {
  WebexAttachmentAction,
  WebexMessage,
  WebexPerson,
  WebexRoom,
} from "../../src/types";

export const WEBEX_BASE_URL = "https://webexapis.com/v1";
export const FILE_BASE_URL = "https://files.webexapis.test/contents";

export interface RecordedRequest {
  body: unknown;
  headers: Headers;
  method: string;
  path: string;
  query: URLSearchParams;
  url: string;
}

export interface UploadedFile {
  bytes: Uint8Array;
  name: string;
  type: string;
}

export interface StoredMessage extends WebexMessage {
  editCount?: number;
  updated?: string;
  uploadedFiles?: UploadedFile[];
}

/** What Webex says when `parentId` isn't a message it knows. */
const PARENT_NOT_FOUND =
  'Unable to post message to room: "\\"id\\" is missing from \\"parent\\" object, or its value is not a timeuuid"';

/** Webex rejects the 11th edit of a message. */
export const MAX_EDITS_PER_MESSAGE = 10;

interface InjectedFailure {
  body?: unknown;
  headers?: Record<string, string>;
  match: (request: RecordedRequest) => boolean;
  remaining: number;
  status: number;
}

export interface FakeWebexOptions {
  bot: WebexPerson;
  /** Real Webex rejects un-filtered message listing in group spaces for bots. */
  enforceGroupMentionFilter?: boolean;
  token: string;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function webexError(status: number, message: string): Response {
  return json({ message, errors: [{ description: message }], trackingId: "fake-tracking-id" }, status);
}

export class FakeWebexApi {
  readonly bot: WebexPerson;
  readonly requests: RecordedRequest[] = [];
  readonly rooms = new Map<string, WebexRoom>();
  readonly people = new Map<string, WebexPerson>();
  readonly messages = new Map<string, StoredMessage>();
  readonly actions = new Map<string, WebexAttachmentAction>();
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  private readonly token: string;
  private readonly enforceGroupMentionFilter: boolean;
  private readonly failures: InjectedFailure[] = [];
  private clock = Date.parse("2026-03-01T09:00:00.000Z");
  private idCounter = 0;

  constructor(options: FakeWebexOptions) {
    this.bot = options.bot;
    this.token = options.token;
    this.enforceGroupMentionFilter = options.enforceGroupMentionFilter ?? true;
    this.people.set(options.bot.id, options.bot);
  }

  // ---------------------------------------------------------------------------
  // Seeding helpers
  // ---------------------------------------------------------------------------

  addPerson(person: WebexPerson): WebexPerson {
    this.people.set(person.id, person);
    return person;
  }

  addRoom(room: WebexRoom): WebexRoom {
    this.rooms.set(room.id, room);
    return room;
  }

  /** Stores a message as if a user had sent it. Returns the stored message. */
  addMessage(message: Partial<StoredMessage> & { roomId: string }): StoredMessage {
    const room = this.rooms.get(message.roomId);
    const author = message.personId ? this.people.get(message.personId) : undefined;
    const stored: StoredMessage = {
      id: message.id ?? this.nextId("msg"),
      created: message.created ?? this.tick(),
      roomType: room?.type,
      personEmail: author?.emails?.[0],
      personDisplayName: author?.displayName,
      personType: author?.type,
      ...message,
    };
    this.messages.set(stored.id, stored);
    if (room) {
      room.lastActivity = stored.created;
    }
    return stored;
  }

  addAttachmentAction(action: Omit<WebexAttachmentAction, "id"> & { id?: string }): WebexAttachmentAction {
    const stored: WebexAttachmentAction = {
      id: action.id ?? this.nextId("action"),
      created: this.tick(),
      type: "submit",
      ...action,
    };
    this.actions.set(stored.id, stored);
    return stored;
  }

  addFile(name: string, bytes: Uint8Array, contentType: string): string {
    // Canonical (encoded) URL, so it matches `request.url` after URL normalisation.
    const url = new URL(`${FILE_BASE_URL}/${this.nextId("file")}/${encodeURIComponent(name)}`).href;
    this.files.set(url, { bytes, contentType });
    return url;
  }

  /** Makes the next `times` requests matching `match` fail with `status`. */
  failNext(
    match: { method?: string; path: string | RegExp },
    status: number,
    options: { body?: unknown; headers?: Record<string, string>; times?: number } = {}
  ): void {
    this.failures.push({
      status,
      body: options.body,
      headers: options.headers,
      remaining: options.times ?? 1,
      match: (request) =>
        (!match.method || request.method === match.method.toUpperCase()) &&
        (typeof match.path === "string" ? request.path === match.path : match.path.test(request.path)),
    });
  }

  // ---------------------------------------------------------------------------
  // Inspection helpers
  // ---------------------------------------------------------------------------

  requestsTo(method: string, path: string | RegExp): RecordedRequest[] {
    return this.requests.filter(
      (request) =>
        request.method === method.toUpperCase() &&
        (typeof path === "string" ? request.path === path : path.test(request.path))
    );
  }

  /** Messages the bot has posted, in creation order. */
  botMessages(): StoredMessage[] {
    return [...this.messages.values()].filter((message) => message.personId === this.bot.id);
  }

  directRoomFor(personId: string): WebexRoom | undefined {
    return [...this.rooms.values()].find((room) => room.type === "direct" && room.id === `direct-${personId}`);
  }

  // ---------------------------------------------------------------------------
  // fetch implementation
  // ---------------------------------------------------------------------------

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const body = await this.readBody(request);

    const isFileDownload = request.url.startsWith(FILE_BASE_URL);
    const path = isFileDownload ? url.pathname : url.pathname.replace(/^\/v1/, "");

    const recorded: RecordedRequest = {
      url: request.url,
      method,
      path,
      query: url.searchParams,
      headers: request.headers,
      body,
    };
    this.requests.push(recorded);

    if (request.headers.get("authorization") !== `Bearer ${this.token}`) {
      return webexError(401, "The request requires a valid access token.");
    }

    const failure = this.failures.find((candidate) => candidate.remaining > 0 && candidate.match(recorded));
    if (failure) {
      failure.remaining -= 1;
      return failure.body === undefined
        ? new Response(null, { status: failure.status, headers: failure.headers })
        : json(failure.body, failure.status, failure.headers);
    }

    if (isFileDownload) {
      const file = this.files.get(request.url);
      if (!file) {
        return webexError(404, "File not found");
      }
      return new Response(new Uint8Array(file.bytes), { status: 200, headers: { "content-type": file.contentType } });
    }

    if (!request.url.startsWith(WEBEX_BASE_URL)) {
      throw new Error(`Unexpected request outside the Webex API: ${method} ${request.url}`);
    }

    return this.route(method, path, url.searchParams, body);
  };

  private async route(method: string, path: string, query: URLSearchParams, body: unknown): Promise<Response> {
    const segments = path.split("/").filter(Boolean).map(decodeURIComponent);

    if (segments[0] === "people" && method === "GET" && segments.length === 2) {
      const id = segments[1] === "me" ? this.bot.id : segments[1];
      const person = this.people.get(id);
      return person ? json(person) : webexError(404, "Person not found");
    }

    if (segments[0] === "rooms" && method === "GET" && segments.length === 2) {
      const room = this.rooms.get(segments[1]);
      return room ? json(room) : webexError(404, "Room not found");
    }

    if (segments[0] === "attachment" && segments[1] === "actions" && method === "GET" && segments.length === 3) {
      const action = this.actions.get(segments[2]);
      return action ? json(action) : webexError(404, "Attachment action not found");
    }

    if (segments[0] === "messages") {
      if (segments.length === 1 && method === "GET") {
        return this.listMessages(query);
      }
      if (segments.length === 1 && method === "POST") {
        return this.createMessage(body);
      }
      if (segments.length === 2) {
        const message = this.messages.get(segments[1]);
        if (!message) {
          return webexError(404, "Unable to get message.");
        }
        if (method === "GET") {
          return json(this.publicMessage(message));
        }
        if (method === "PUT") {
          return this.editMessage(message, body);
        }
        if (method === "DELETE") {
          this.messages.delete(message.id);
          return new Response(null, { status: 204 });
        }
      }
    }

    return webexError(404, `No fake route for ${method} ${path}`);
  }

  private listMessages(query: URLSearchParams): Response {
    const roomId = query.get("roomId");
    if (!roomId) {
      return webexError(400, "roomId is required");
    }
    const room = this.rooms.get(roomId);
    if (!room) {
      return webexError(404, "Room not found");
    }

    const mentionedOnly = query.get("mentionedPeople") === "me";
    if (this.enforceGroupMentionFilter && room.type === "group" && !mentionedOnly) {
      return webexError(403, "Bots can only list messages that mention them in group spaces.");
    }

    const max = Math.min(Number(query.get("max") || 50), 100);
    const beforeMessage = query.get("beforeMessage");

    // Newest first; insertion order breaks timestamp ties so the order is total.
    const insertionOrder = new Map([...this.messages.keys()].map((id, index) => [id, index]));
    let items = [...this.messages.values()]
      .filter((message) => message.roomId === roomId)
      .sort(
        (a, b) =>
          Date.parse(b.created ?? "") - Date.parse(a.created ?? "") ||
          (insertionOrder.get(b.id) ?? 0) - (insertionOrder.get(a.id) ?? 0)
      );

    // The cursor is a position in the full room timeline, applied before any
    // filter, so messages sharing the pivot's timestamp are never skipped.
    if (beforeMessage) {
      const pivotIndex = items.findIndex((message) => message.id === beforeMessage);
      if (pivotIndex === -1) {
        return webexError(404, "beforeMessage not found");
      }
      items = items.slice(pivotIndex + 1);
    }

    if (mentionedOnly) {
      items = items.filter((message) => message.mentionedPeople?.includes(this.bot.id));
    }

    return json({ items: items.slice(0, max).map((message) => this.publicMessage(message)) });
  }

  private async createMessage(body: unknown): Promise<Response> {
    const fields = body instanceof FormData ? this.formFields(body) : ((body ?? {}) as Record<string, unknown>);
    const roomIdField = typeof fields.roomId === "string" ? fields.roomId : undefined;
    const toPersonId = typeof fields.toPersonId === "string" ? fields.toPersonId : undefined;

    if (!roomIdField && !toPersonId) {
      return webexError(400, "Either roomId or toPersonId is required.");
    }

    let room: WebexRoom | undefined;
    if (roomIdField) {
      room = this.rooms.get(roomIdField);
      if (!room) {
        return webexError(404, "Room not found");
      }
    } else if (toPersonId) {
      if (!this.people.has(toPersonId)) {
        return webexError(404, "Person not found");
      }
      room =
        this.directRoomFor(toPersonId) ??
        this.addRoom({ id: `direct-${toPersonId}`, type: "direct", title: this.people.get(toPersonId)?.displayName });
    }

    const parentId = typeof fields.parentId === "string" ? fields.parentId : undefined;
    if (parentId) {
      const parent = this.messages.get(parentId);
      if (!parent || parent.roomId !== room?.id) {
        return webexError(400, PARENT_NOT_FOUND);
      }
      if (parent.parentId) {
        return webexError(400, "Replies to replies are not supported.");
      }
    }

    const uploadedFiles: UploadedFile[] = [];
    if (body instanceof FormData) {
      for (const entry of body.getAll("files")) {
        if (entry instanceof File) {
          const bytes = new Uint8Array(await entry.arrayBuffer());
          uploadedFiles.push({ name: entry.name, type: entry.type, bytes });
        }
      }
    }

    const stored = this.addMessage({
      roomId: room?.id as string,
      parentId,
      personId: this.bot.id,
      personEmail: this.bot.emails?.[0],
      personType: "bot",
      markdown: typeof fields.markdown === "string" ? fields.markdown : undefined,
      text: typeof fields.text === "string" ? fields.text : undefined,
      attachments: Array.isArray(fields.attachments)
        ? (fields.attachments as StoredMessage["attachments"])
        : undefined,
      // Uploaded files become downloadable content URLs, like Webex `files`.
      files: uploadedFiles.map((file) => this.addFile(file.name, file.bytes, file.type || "application/octet-stream")),
      uploadedFiles: uploadedFiles.length > 0 ? uploadedFiles : undefined,
    });

    return json(this.publicMessage(stored));
  }

  private editMessage(message: StoredMessage, body: unknown): Response {
    const fields = (body ?? {}) as Record<string, unknown>;
    const markdown = typeof fields.markdown === "string" ? fields.markdown : undefined;
    const text = typeof fields.text === "string" ? fields.text : undefined;

    if (typeof fields.roomId !== "string") {
      return webexError(400, "Invalid roomId");
    }
    if (!this.rooms.has(fields.roomId)) {
      return webexError(404, "Could not find a room with provided ID.");
    }
    if (markdown === undefined && text === undefined) {
      return webexError(400, "One of the following must be non-empty: text, file, or meetingId");
    }
    if (fields.roomId !== message.roomId) {
      return webexError(400, "roomId does not match the message.");
    }
    if (message.personId !== this.bot.id) {
      return webexError(400, 'Unable to post message to room: "User does not have permission to edit this activity"');
    }
    if ((message.files?.length ?? 0) > 0) {
      return webexError(400, "Unable to post message to room: Unable to modify this type of message.");
    }
    if ((message.editCount ?? 0) >= MAX_EDITS_PER_MESSAGE) {
      return webexError(400, 'Unable to post message to room: "Max allowed number of edits per activity reached"');
    }

    message.markdown = markdown;
    message.text = text ?? markdown;
    message.attachments =
      Array.isArray(fields.attachments) && fields.attachments.length > 0
        ? (fields.attachments as WebexMessage["attachments"])
        : undefined;
    message.editCount = (message.editCount ?? 0) + 1;
    message.updated = this.tick();
    return json(this.publicMessage(message));
  }

  private publicMessage(message: StoredMessage): WebexMessage {
    const { uploadedFiles: _uploaded, editCount: _edits, ...rest } = message;
    return {
      ...rest,
      files: rest.files && rest.files.length > 0 ? rest.files : undefined,
    };
  }

  private formFields(form: FormData): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") {
        fields[key] = value;
      }
    }
    return fields;
  }

  private async readBody(request: Request): Promise<unknown> {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "DELETE") {
      return undefined;
    }
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      return request.formData();
    }
    const text = await request.text();
    if (!text) {
      return undefined;
    }
    if (contentType.includes("application/json")) {
      return JSON.parse(text) as unknown;
    }
    return text;
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
}
