# Outlook connector — agent actions

This connector receives **events** (`message.received` when new mail appears in the mailbox **Inbox** via Microsoft Graph delta sync) and exposes **actions** your agent can call over the Paperclip HTTP API using the same credentials as other agent calls (`Authorization: Bearer $PAPERCLIP_API_KEY`).

## Who may call actions

- **Board / operator session** — users with `connectors.manage` for the company.
- **Agent API key** — only if that agent has at least one **enabled** event binding on this same Outlook connection.

Always send `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` when you have a run id (heartbeat / connector wake), so the control plane can trace the call.

## Endpoint

`POST` `{PAPERCLIP_API_URL}/api/companies/{PAPERCLIP_COMPANY_ID}/connectors/{connectionId}/actions`

`connectionId` is the UUID of the Outlook connection. When you are woken from a connector binding, the run context includes `connectorConnectionId` — use that value.

JSON body:

```json
{
  "action": "outlook.message.send",
  "params": { "to": "user@example.com", "subject": "Hello", "text": "Body" }
}
```

## Actions

### `outlook.message.send`

Sends a new message from the connected mailbox (plain text).

| Param        | Type   | Required | Notes |
|-------------|--------|------------|--------|
| `to`        | string | yes        | Primary recipient (single address). |
| `subject`   | string | yes        | Plain subject line. |
| `text`      | string | yes        | Plain-text body. |
| `cc`        | string | no         | Optional comma-separated addresses. |
| `threadId`  | string | no         | Microsoft Graph **conversation** id to keep the message in an existing thread. |

Response JSON includes `{ "action": "outlook.message.send", "sent": true }` on success.

### `outlook.draft.create`

Creates a draft (does not send). Same `params` as `outlook.message.send`.

Response includes `messageId` and `threadId` when Graph returns them.

## Operator setup

Register a Microsoft Entra **application** with:

- **Redirect URI** (web): `{PAPERCLIP_PUBLIC_URL}/api/connectors/outlook/oauth/callback` (or the value you set in `PAPERCLIP_OUTLOOK_OAUTH_REDIRECT_URI`).
- **Delegated permissions**: `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`, `openid`, `profile`.

Server environment variables:

- `PAPERCLIP_OUTLOOK_OAUTH_CLIENT_ID`
- `PAPERCLIP_OUTLOOK_OAUTH_CLIENT_SECRET`
- Optional: `PAPERCLIP_OUTLOOK_OAUTH_REDIRECT_URI`, `PAPERCLIP_OUTLOOK_OAUTH_TENANT_ID` (default single-tenant or `common` / `organizations` as supported by your app registration).
- Optional: `PAPERCLIP_OUTLOOK_SYNC_ENABLED` (default on), `PAPERCLIP_OUTLOOK_SYNC_INTERVAL_MS`.

## Re-consent

If you change API permissions in Entra, users must **Reconnect with Microsoft** so tokens include the new scopes.
