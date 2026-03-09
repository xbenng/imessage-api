# iMessage API

REST API server for reading and sending iMessages. Reads the macOS Messages database (`chat.db`) directly and serves data over HTTP with JWT authentication.

## Requirements

- macOS with Messages app
- Node.js 18+
- **Full Disk Access** granted to your terminal (System Settings > Privacy & Security > Full Disk Access)

## Setup

```bash
npm install
```

### Configure authentication

Generate a password hash:

```bash
node -e "import('bcryptjs').then(b => b.default.hash('YOUR_PASSWORD', 12).then(console.log))"
```

Edit `.env`:

```
PORT=3001
AUTH_SECRET=<random-string-at-least-32-chars>
AUTH_PASSWORD_HASH='<bcrypt-hash-from-above>'
CORS_ORIGIN=http://localhost:3000
```

> Wrap the hash in single quotes to prevent `$` interpolation.

### Run

```bash
npm run dev    # development with hot reload
npm run build  # compile TypeScript
npm start      # production
```

On first startup the server builds a full-text search index (~162K messages takes ~15 seconds). Subsequent starts are instant. The index auto-refreshes every 30 seconds.

## API Reference

All endpoints except `/auth/login` and `/health` require an `Authorization: Bearer <token>` header.

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/login` | Returns a JWT token. Body: `{ "password": "..." }` |

### Chats

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/chats` | List chats sorted by most recent message. Query: `?limit=100` |
| `GET` | `/chats/:id` | Single chat with participants |

### Messages

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/chats/:id/messages` | Paginated messages. Query: `?before=<rowid>&limit=50` |
| `GET` | `/messages/recent` | New messages since cursor. Query: `?since=<rowid>` |
| `GET` | `/messages/cursor` | Current max message ROWID (for initializing polling) |

### Search

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/search` | Full-text search. Query: `?q=<query>&limit=50` |

### Attachments

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/attachments/:id` | Serve an attachment file with correct MIME type |

### Sending

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/send` | Send a message. Body: `{ "to": "+1...", "text": "...", "service": "iMessage" }` |

`service` is `"iMessage"` or `"SMS"`. Requires Messages.app to be running.

### Other

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (no auth required) |
| `GET` | `/contacts` | Contact name map (handle → display name) |

## Response Schemas

### Chat

```json
{
  "id": 6,
  "guid": "iMessage;-;+15551234567",
  "chatIdentifier": "+15551234567",
  "displayName": "John Smith",
  "style": 45,
  "serviceName": "iMessage",
  "participants": [
    { "handleId": "+15551234567", "displayName": "John Smith", "service": "iMessage" }
  ],
  "lastMessageDate": 1740000000000,
  "lastMessagePreview": "See you tomorrow!",
  "messageCount": 20947
}
```

`style`: 45 = individual, 43 = group.

### Message

```json
{
  "id": 164430,
  "guid": "...",
  "text": "By 3:30",
  "isFromMe": false,
  "date": 1740000000000,
  "dateRead": null,
  "dateDelivered": null,
  "handleId": "+15551234567",
  "senderName": "John Smith",
  "chatId": 6,
  "associatedMessageType": 0,
  "associatedMessageGuid": null,
  "threadOriginatorGuid": null,
  "attachments": [],
  "tapbacks": [
    { "type": 2000, "isFromMe": true, "senderName": "You", "associatedMessageGuid": "..." }
  ],
  "isAudioMessage": false,
  "expressiveSendStyleId": null,
  "service": "iMessage"
}
```

Tapback types: 2000 = love, 2001 = like, 2002 = laugh, 2003 = emphasis, 2004 = dislike, 2005 = question.

Timestamps are Unix milliseconds. `null` means not available.

### Polling

Use `/messages/cursor` to get the initial cursor, then poll `/messages/recent?since=<cursor>` every few seconds:

```json
{
  "messages": [ ... ],
  "maxRowid": 164430
}
```

Use the returned `maxRowid` as the `since` value for the next poll.

## Architecture

```
chat.db (read-only) ──► Hono API server ──► Any HTTP client
                          │
index.db (FTS5) ◄─────────┘
```

- **chat.db** is opened read-only in WAL mode. No writes are ever made to the Messages database.
- **index.db** is a separate SQLite database with an FTS5 virtual table for full-text search. Auto-created in `data/`.
- **Contact names** are resolved by querying macOS Contacts via JXA (JavaScript for Automation). Cached to `data/contacts-cache.json` with a 1-hour TTL.
- **Message text** is extracted from binary `attributedBody` blobs (NSMutableAttributedString format) since the `text` column is empty for most messages.

## Project Structure

```
src/
  index.ts              Entry point, middleware, route mounting
  routes/
    auth.ts             POST /auth/login
    chats.ts            GET /chats, GET /chats/:id
    messages.ts         GET /chats/:id/messages, GET /messages/recent, GET /messages/cursor
    search.ts           GET /search
    attachments.ts      GET /attachments/:id
    send.ts             POST /send
    contacts.ts         GET /contacts
  lib/
    db.ts               Database connections (chat.db + index.db)
    queries.ts          SQL prepared statements and data enrichment
    attributed-body.ts  Binary parser for NSAttributedString blobs
    timestamps.ts       macOS Cocoa epoch ↔ Unix timestamp conversion
    search-index.ts     FTS5 index build and query
    contacts.ts         macOS Contacts resolution via JXA
    auth.ts             JWT creation and verification
  types/
    index.ts            TypeScript interfaces
  middleware/
    auth.ts             Bearer token auth middleware
    cors.ts             CORS middleware
```
