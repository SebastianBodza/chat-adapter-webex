/** Thread identifier for Webex, composed of a room ID and root message ID. */
export interface WebexThreadId {
  /** Webex room (space) ID, or a `dm:<personId>` pseudo-ID for direct messages. */
  roomId: string;
  /** ID of the root message that anchors the thread. */
  rootMessageId: string;
}

/** Raw message payload returned by the Webex Messages API. */
export interface WebexMessage {
  /** Unique message identifier. */
  id: string;
  /** Room (space) the message belongs to. */
  roomId: string;
  /** Parent message ID when this message is a thread reply. */
  parentId?: string;
  /** Person ID of the message sender. */
  personId?: string;
  /** Email address of the message sender. */
  personEmail?: string;
  /** Display name of the message sender. */
  personDisplayName?: string;
  /** Whether the sender is a person or a bot. */
  personType?: "person" | "bot";
  /** Plain-text content of the message. */
  text?: string;
  /** Markdown-formatted content of the message. */
  markdown?: string;
  /** ISO 8601 timestamp of when the message was created. */
  created?: string;
  /** List of person IDs mentioned in the message. */
  mentionedPeople?: string[];
  /** Whether the room is a direct (1:1) or group space. */
  roomType?: "direct" | "group";
  /** URLs of files attached to the message. */
  files?: string[];
  /** Adaptive Card attachments on the message. */
  attachments?: Array<{
    contentType?: string;
    content?: unknown;
  }>;
}

/** Room (space) details returned by the Webex Rooms API. */
export interface WebexRoom {
  /** Unique room identifier. */
  id: string;
  /** Human-readable room title. */
  title?: string;
  /** Whether the room is a direct (1:1) or group space. */
  type?: "direct" | "group";
  /** Whether the room is moderated (locked). */
  isLocked?: boolean;
  /** ISO 8601 timestamp of the last activity in the room. */
  lastActivity?: string;
}

/** Person details returned by the Webex People API. */
export interface WebexPerson {
  /** Unique person identifier. */
  id: string;
  /** Full display name. */
  displayName?: string;
  /** Short nickname. */
  nickName?: string;
  /** Whether the person is a human or a bot. */
  type?: "person" | "bot";
  /** Email addresses associated with the person. */
  emails?: string[];
}

/** Attachment action payload returned when a user interacts with an Adaptive Card. */
export interface WebexAttachmentAction {
  /** Unique action identifier. */
  id: string;
  /** Action type (e.g., `"submit"`). */
  type?: string;
  /** ID of the message the card was attached to. */
  messageId: string;
  /** Room where the action occurred. */
  roomId?: string;
  /** Person who performed the action. */
  personId?: string;
  /** Key-value pairs from the card's input fields and data payloads. */
  inputs?: Record<string, string>;
  /** ISO 8601 timestamp of when the action was created. */
  created?: string;
}

/** Webhook event payload sent by Webex to the registered webhook URL. */
export interface WebexWebhookPayload {
  /** Unique webhook event identifier. */
  id?: string;
  /** Resource type (e.g., `"messages"`, `"attachmentActions"`). */
  resource: string;
  /** Event type (e.g., `"created"`). */
  event: string;
  /** Person ID of the actor who triggered the event. */
  actorId?: string;
  /** Organization ID. */
  orgId?: string;
  /** Person ID of the webhook creator. */
  createdBy?: string;
  /** Application ID. */
  appId?: string;
  /** Resource-specific data included in the webhook. */
  data?: {
    id?: string;
    roomId?: string;
    personId?: string;
    personEmail?: string;
    messageId?: string;
    created?: string;
  };
}

/** Paginated response from the Webex List Messages API. */
export interface WebexListMessagesResponse {
  items: WebexMessage[];
}

/** Reaction on a Webex message. */
export interface WebexReaction {
  /** Unique reaction identifier. */
  id: string;
  /** ID of the message the reaction is on. */
  messageId: string;
  /** Room where the message lives. */
  roomId?: string;
  /** Person who added the reaction. */
  personId: string;
  /** Email of the person who added the reaction. */
  personEmail?: string;
  /** Reaction shortcode (e.g., `"thumbsup"`). */
  reaction: string;
  /** ISO 8601 timestamp of when the reaction was added. */
  created?: string;
}

/** Paginated response from the Webex List Reactions API. */
export interface WebexListReactionsResponse {
  items: WebexReaction[];
}
