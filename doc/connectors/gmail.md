# Gmail connector — agent actions

This connector receives **events** (`message.received` when new mail is synced) and exposes **actions** your agent can call over the Paperclip HTTP API using the same credentials as other agent calls (`Authorization: Bearer $PAPERCLIP_API_KEY`).

## Who may call actions

- **Board / operator session** — users with `connectors.manage` for the company.
- **Agent API key** — only if that agent has at least one **enabled** event binding on this same Gmail connection. That binding is what links the agent to the mailbox for outbound actions.

Always send `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` when you have a run id (heartbeat / connector wake), so the control plane can trace the call.

## Endpoint

`POST` `{PAPERCLIP_API_URL}/api/companies/{PAPERCLIP_COMPANY_ID}/connectors/{connectionId}/actions`

`connectionId` is the UUID of the Gmail connection (the same connection that delivered the inbound event). When you are woken from a connector binding, the run context includes `connectorConnectionId` — use that value.

JSON body:

```json
{
  "action": "gmail.message.send",
  "params": { "to": "user@example.com", "subject": "Hello", "text": "Body" }
}
```

## Actions

### `gmail.message.send`

Sends a new message from the connected mailbox.

| Param       | Type   | Required | Notes |
|------------|--------|----------|--------|
| `to`       | string | yes      | Primary recipient (single address). |
| `subject`  | string | yes      | Plain subject line. |
| `text`     | string | yes      | Plain-text body. |
| `cc`       | string | no       | Optional comma-separated addresses. |
| `threadId` | string | no       | If set, Gmail may associate the message with that thread. |

Response JSON includes `messageId` and `threadId` when Gmail returns them.

### `gmail.draft.create`

Creates a draft (does not send).

Same `params` shape as `gmail.message.send`. Response includes `draftId`.

## Re-consent

Outbound actions require OAuth scopes that include **send** / **compose**. If the operator adds this capability after mailboxes were connected, users must **Reconnect with Google** once so Google issues tokens with the expanded scopes.
