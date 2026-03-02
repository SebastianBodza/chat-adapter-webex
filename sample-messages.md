# Webex Sample Messages (Real Capture)

All samples below come from this real recording:
`examples/nextjs-chat/.logs/session-webex-full-20260302.json`

Sensitive values (email addresses and webhook target URL) are redacted, but payload shapes and fields are unchanged.

## Capture Metadata

```json
{
  "source": "examples/nextjs-chat/.logs/session-webex-full-20260302.json",
  "records": 125,
  "startedAt": "2026-03-02T20:25:42.436Z",
  "endedAt": "2026-03-02T20:28:57.882Z",
  "counts": {
    "webhooks": 28,
    "fetch": 65,
    "apiCall": 32
  }
}
```

## Webhook: `messages.created`

```json
{
  "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1dFQkhPT0svMjU0NWI5NmUtZTIyNy00YmJmLWIyZWEtNDhmZjcxMWY5ZjIz",
  "name": "chat-sdk-webex-messages-created",
  "targetUrl": "https://redacted.example.invalid/api/webhooks/webex",
  "resource": "messages",
  "event": "created",
  "orgId": "Y2lzY29zcGFyazovL3VzL09SR0FOSVpBVElPTi83MWI2YjM0Yy1hYmZmLTQ0MDctYWM1MC01ZTYyMzIzYWVkODA",
  "createdBy": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS8zY2RkNDA1OS05MjU4LTQ3N2QtYjQ5NC1jMTMzYWMyY2ZhZDU",
  "appId": "Y2lzY29zcGFyazovL3VzL0FQUExJQ0FUSU9OL0MzMmM4MDc3NDBjNmU3ZGYxMWRhZjE2ZjIyOGRmNjI4YmJjYTQ5YmE1MmZlY2JiMmM3ZDUxNWNiNGEwY2M5MWFh",
  "ownedBy": "creator",
  "status": "active",
  "created": "2026-02-25T19:19:04.231Z",
  "actorId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS8zY2RkNDA1OS05MjU4LTQ3N2QtYjQ5NC1jMTMzYWMyY2ZhZDU",
  "data": {
    "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvMDgxYzI0MTAtMTY3Ni0xMWYxLTkzYmYtY2Q2NDU0MjVmNTZm",
    "roomId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vODZhMWRhYTAtMTFkMC0xMWYxLWJiM2MtMjc4M2NhYTZlZjQy",
    "roomType": "group",
    "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS8zY2RkNDA1OS05MjU4LTQ3N2QtYjQ5NC1jMTMzYWMyY2ZhZDU",
    "personEmail": "redacted@example.invalid",
    "created": "2026-03-02T20:26:02.321Z",
    "parentId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvOGRlMTdhZjAtMTYwOC0xMWYxLWI1NjctZGJmZDliNTljZWMz"
  }
}
```

## Webhook: `attachmentActions.created`

```json
{
  "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1dFQkhPT0svYWUwOThhNjQtNGJjNy00Y2FhLWJiOTQtMDBjMWZmODE3ZTUy",
  "name": "chat-sdk-webex-attachment-actions-created",
  "targetUrl": "https://redacted.example.invalid/api/webhooks/webex",
  "resource": "attachmentActions",
  "event": "created",
  "orgId": "Y2lzY29zcGFyazovL3VzL09SR0FOSVpBVElPTi83MWI2YjM0Yy1hYmZmLTQ0MDctYWM1MC01ZTYyMzIzYWVkODA",
  "createdBy": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS8zY2RkNDA1OS05MjU4LTQ3N2QtYjQ5NC1jMTMzYWMyY2ZhZDU",
  "appId": "Y2lzY29zcGFyazovL3VzL0FQUExJQ0FUSU9OL0MzMmM4MDc3NDBjNmU3ZGYxMWRhZjE2ZjIyOGRmNjI4YmJjYTQ5YmE1MmZlY2JiMmM3ZDUxNWNiNGEwY2M5MWFh",
  "ownedBy": "creator",
  "status": "active",
  "created": "2026-02-25T19:19:04.436Z",
  "actorId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9lMjg5YTQ3MC05ODE4LTQ4MmItYjI1ZC00MTYyYWE4OWQ4NWU",
  "data": {
    "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL0FUVEFDSE1FTlRfQUNUSU9OL2ZiMzExYTgwLTE2NzUtMTFmMS04MzQzLTFkNDc2OTdmMWJlMQ",
    "type": "submit",
    "messageId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvZDFmMzUyOTAtMTYwOC0xMWYxLTg3MmItOTVkMDdlYjFkYmJk",
    "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9lMjg5YTQ3MC05ODE4LTQ4MmItYjI1ZC00MTYyYWE4OWQ4NWU",
    "roomId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vMjhhOTBjNzAtMTI3Zi0xMWYxLTgxMWEtZWY5MjlkNWIyMjI0",
    "created": "2026-03-02T20:25:40.648Z"
  }
}
```

## API: `GET /messages/{id}` - Direct Message (top-level)

```json
{
  "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvMzk5YWUzMDAtMTY3Ni0xMWYxLWI3MmQtZGQ3YjE0YTcxNDA3",
  "roomId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vMjhhOTBjNzAtMTI3Zi0xMWYxLTgxMWEtZWY5MjlkNWIyMjI0",
  "roomType": "direct",
  "text": "This is the direct message DM me ",
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9lMjg5YTQ3MC05ODE4LTQ4MmItYjI1ZC00MTYyYWE4OWQ4NWU",
  "personEmail": "redacted@example.invalid",
  "created": "2026-03-02T20:27:25.360Z"
}
```

## API: `GET /messages/{id}` - Group Thread Reply with Adaptive Card

```json
{
  "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvOWQzYmQ2ZDAtMTYwOC0xMWYxLTgzNDMtMWQ0NzY5N2YxYmUx",
  "roomId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vODZhMWRhYTAtMTFkMC0xMWYxLWJiM2MtMjc4M2NhYTZlZjQy",
  "roomType": "group",
  "text": "\uD83D\uDCDD More Actions Additional demo actions for Webex:",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "content": {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.3",
        "body": [
          {
            "type": "TextBlock",
            "text": "\uD83D\uDCDD More Actions",
            "weight": "Bolder",
            "size": "Medium",
            "wrap": true
          },
          {
            "type": "TextBlock",
            "text": "Additional demo actions for Webex:",
            "wrap": true
          }
        ],
        "actions": [
          {
            "type": "Action.Submit",
            "title": "Fetch Messages",
            "data": {
              "actionId": "messages"
            }
          },
          {
            "type": "Action.Submit",
            "title": "Channel Post",
            "data": {
              "actionId": "channel-post"
            }
          },
          {
            "type": "Action.Submit",
            "title": "Thread Metadata",
            "data": {
              "actionId": "thread-meta"
            }
          },
          {
            "type": "Action.Submit",
            "title": "List Threads",
            "data": {
              "actionId": "list-threads"
            }
          },
          {
            "type": "Action.Submit",
            "title": "Report Bug",
            "data": {
              "actionId": "report",
              "value": "bug"
            }
          },
          {
            "type": "Action.OpenUrl",
            "title": "Open Link",
            "url": "https://vercel.com"
          },
          {
            "type": "Action.Submit",
            "title": "Goodbye",
            "data": {
              "actionId": "goodbye"
            },
            "style": "destructive"
          }
        ]
      }
    }
  ],
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS8zY2RkNDA1OS05MjU4LTQ3N2QtYjQ5NC1jMTMzYWMyY2ZhZDU",
  "personEmail": "redacted@example.invalid",
  "markdown": "**\uD83D\uDCDD More Actions**\n\nAdditional demo actions for Webex:",
  "html": "<p><strong>\uD83D\uDCDD More Actions</strong></p><p>Additional demo actions for Webex:</p>",
  "created": "2026-03-02T07:22:47.869Z",
  "parentId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvOGRlMTdhZjAtMTYwOC0xMWYxLWI1NjctZGJmZDliNTljZWMz"
}
```

## API: `GET /messages/{id}` - Threaded Modal Card Message

```json
{
  "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvZDFmMzUyOTAtMTYwOC0xMWYxLTg3MmItOTVkMDdlYjFkYmJk",
  "roomId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vMjhhOTBjNzAtMTI3Zi0xMWYxLTgxMWEtZWY5MjlkNWIyMjI0",
  "roomType": "direct",
  "text": "Ephemeral Modal Please fill out this form card and click Submit.",
  "attachments": [
    {
      "contentType": "application/vnd.microsoft.card.adaptive",
      "content": {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.3",
        "body": [
          {
            "type": "TextBlock",
            "text": "Ephemeral Modal",
            "weight": "Bolder",
            "size": "Medium",
            "wrap": true
          },
          {
            "type": "Input.Text",
            "id": "response",
            "label": "Your Response",
            "isMultiline": false,
            "placeholder": "Type something..."
          }
        ],
        "actions": [
          {
            "type": "Action.Submit",
            "title": "Submit",
            "data": {
              "_chat_modal": "1",
              "_chat_modal_view_id": "2eb60a60-75c5-405f-a1df-767d2b1c99f9",
              "_chat_modal_callback_id": "ephemeral_modal_form",
              "_chat_modal_context_id": "da6e94fc-d414-4a5b-ba6a-33f88dffd9a4",
              "_chat_modal_private_metadata": "",
              "actionId": "__chat_modal_submit:2eb60a60-75c5-405f-a1df-767d2b1c99f9",
              "_chat_modal_action": "submit"
            }
          },
          {
            "type": "Action.Submit",
            "title": "Cancel",
            "data": {
              "_chat_modal": "1",
              "_chat_modal_view_id": "2eb60a60-75c5-405f-a1df-767d2b1c99f9",
              "_chat_modal_callback_id": "ephemeral_modal_form",
              "_chat_modal_context_id": "da6e94fc-d414-4a5b-ba6a-33f88dffd9a4",
              "_chat_modal_private_metadata": "",
              "actionId": "__chat_modal_close:2eb60a60-75c5-405f-a1df-767d2b1c99f9",
              "_chat_modal_action": "close"
            }
          }
        ]
      }
    }
  ],
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS8zY2RkNDA1OS05MjU4LTQ3N2QtYjQ5NC1jMTMzYWMyY2ZhZDU",
  "personEmail": "redacted@example.invalid",
  "markdown": "Ephemeral Modal\nPlease fill out this form card and click Submit.",
  "html": "<p>Ephemeral Modal<br>Please fill out this form card and click Submit.</p>",
  "created": "2026-03-02T07:24:16.313Z",
  "parentId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvY2JlZTJmNTAtMTYwOC0xMWYxLWI2ZjUtNzU0ZjRhN2VmNmRj"
}
```

## API: `GET /messages/{id}` - Message with File Attachment

```json
{
  "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvNjFhZWJlNzAtMTY3Ni0xMWYxLTg2MTEtZjEzZTM2NDk5Zjk3",
  "roomId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vMjhhOTBjNzAtMTI3Zi0xMWYxLTgxMWEtZWY5MjlkNWIyMjI0",
  "roomType": "direct",
  "text": "This is a sample message with attachement ",
  "files": [
    "https://webexapis.com/v1/contents/Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL0NPTlRFTlQvNjFhZWJlNzAtMTY3Ni0xMWYxLTg2MTEtZjEzZTM2NDk5Zjk3LzA"
  ],
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9lMjg5YTQ3MC05ODE4LTQ4MmItYjI1ZC00MTYyYWE4OWQ4NWU",
  "personEmail": "redacted@example.invalid",
  "created": "2026-03-02T20:28:32.599Z",
  "parentId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvMzk5YWUzMDAtMTY3Ni0xMWYxLWI3MmQtZGQ3YjE0YTcxNDA3",
  "isVoiceClip": false
}
```

## API: `GET /messages?...mentionedPeople=me` - Mention Item (from `items[]`)

Source URL from capture:

```text
https://webexapis.com/v1/messages?roomId=Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vODZhMWRhYTAtMTFkMC0xMWYxLWJiM2MtMjc4M2NhYTZlZjQy&max=50&mentionedPeople=me
```

```json
{
  "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvOGRlMTdhZjAtMTYwOC0xMWYxLWI1NjctZGJmZDliNTljZWMz",
  "roomId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vODZhMWRhYTAtMTFkMC0xMWYxLWJiM2MtMjc4M2NhYTZlZjQy",
  "roomType": "group",
  "text": "DummytestbotForChatSDK hello",
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9lMjg5YTQ3MC05ODE4LTQ4MmItYjI1ZC00MTYyYWE4OWQ4NWU",
  "personEmail": "redacted@example.invalid",
  "html": "<p><spark-mention data-object-type=\"person\" data-object-id=\"Y2lzY29zcGFyazovL3VzL1BFT1BMRS8zY2RkNDA1OS05MjU4LTQ3N2QtYjQ5NC1jMTMzYWMyY2ZhZDU\">DummytestbotForChatSDK</spark-mention> hello</p>",
  "mentionedPeople": [
    "Y2lzY29zcGFyazovL3VzL1BFT1BMRS8zY2RkNDA1OS05MjU4LTQ3N2QtYjQ5NC1jMTMzYWMyY2ZhZDU"
  ],
  "created": "2026-03-02T07:22:22.111Z"
}
```

## API: `GET /attachment/actions/{id}` - Standard Action Submit

```json
{
  "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL0FUVEFDSE1FTlRfQUNUSU9OLzA1N2Y1OTIwLTE2NzYtMTFmMS04NjExLWYxM2UzNjQ5OWY5Nw",
  "type": "submit",
  "messageId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvOWQzYmQ2ZDAtMTYwOC0xMWYxLTgzNDMtMWQ0NzY5N2YxYmUx",
  "inputs": {
    "actionId": "messages"
  },
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9lMjg5YTQ3MC05ODE4LTQ4MmItYjI1ZC00MTYyYWE4OWQ4NWU",
  "roomId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vODZhMWRhYTAtMTFkMC0xMWYxLWJiM2MtMjc4M2NhYTZlZjQy",
  "created": "2026-03-02T20:25:57.938Z"
}
```

## API: `GET /attachment/actions/{id}` - Modal Submit Action

```json
{
  "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL0FUVEFDSE1FTlRfQUNUSU9OL2ZiMzExYTgwLTE2NzUtMTFmMS04MzQzLTFkNDc2OTdmMWJlMQ",
  "type": "submit",
  "messageId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL01FU1NBR0UvZDFmMzUyOTAtMTYwOC0xMWYxLTg3MmItOTVkMDdlYjFkYmJk",
  "inputs": {
    "_chat_modal": "1",
    "_chat_modal_action": "submit",
    "_chat_modal_callback_id": "ephemeral_modal_form",
    "_chat_modal_context_id": "da6e94fc-d414-4a5b-ba6a-33f88dffd9a4",
    "_chat_modal_private_metadata": "",
    "_chat_modal_view_id": "2eb60a60-75c5-405f-a1df-767d2b1c99f9",
    "actionId": "__chat_modal_submit:2eb60a60-75c5-405f-a1df-767d2b1c99f9",
    "response": "test"
  },
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9lMjg5YTQ3MC05ODE4LTQ4MmItYjI1ZC00MTYyYWE4OWQ4NWU",
  "roomId": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vMjhhOTBjNzAtMTI3Zi0xMWYxLTgxMWEtZWY5MjlkNWIyMjI0",
  "created": "2026-03-02T20:25:40.648Z"
}
```

## API: `GET /rooms/{id}` - Group Room

```json
{
  "id": "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vODZhMWRhYTAtMTFkMC0xMWYxLWJiM2MtMjc4M2NhYTZlZjQy",
  "title": "Bereich von Sebastian",
  "type": "group",
  "isLocked": false,
  "lastActivity": "2026-03-02T20:26:02.321Z",
  "creatorId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9lMjg5YTQ3MC05ODE4LTQ4MmItYjI1ZC00MTYyYWE4OWQ4NWU",
  "created": "2026-02-24T22:31:13.482Z",
  "ownerId": "Y2lzY29zcGFyazovL3VzL09SR0FOSVpBVElPTi83MWI2YjM0Yy1hYmZmLTQ0MDctYWM1MC01ZTYyMzIzYWVkODA",
  "isPublic": false,
  "isReadOnly": false
}
```

## Notes From This Capture

- Includes both `direct` and `group` message traffic.
- Includes mention parsing signal (`mentionedPeople` and `spark-mention` HTML).
- Includes modal submit metadata (`_chat_modal*` keys in attachment action inputs).
- Includes real file attachment payload (`files[]`) from `GET /messages/{id}`.
- Reactions are not included because Webex bot reactions are not implemented in this adapter.
- No `GET /people/*` payloads were captured in this specific run.