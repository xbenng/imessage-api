import { Hono } from "hono";
import { getMessages, getNewMessagesSince, getMaxMessageRowid } from "../lib/queries.js";

const messages = new Hono();

// GET /chats/:id/messages?before=<rowid>&limit=50
messages.get("/chats/:id/messages", (c) => {
  const chatId = parseInt(c.req.param("id"), 10);
  if (isNaN(chatId)) return c.json({ error: "Invalid chat ID" }, 400);

  const before = c.req.query("before") ? parseInt(c.req.query("before")!, 10) : undefined;
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 500);

  const data = getMessages(chatId, before, limit);
  return c.json(data);
});

// GET /messages/recent?since=<rowid>
messages.get("/messages/recent", (c) => {
  const since = parseInt(c.req.query("since") || "0", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "200", 10), 500);

  const data = getNewMessagesSince(since, limit);
  const maxRowid = data.length > 0 ? Math.max(...data.map((m) => m.id)) : since;

  return c.json({ messages: data, maxRowid });
});

// GET /messages/cursor — get current max rowid (for initializing polling)
messages.get("/messages/cursor", (c) => {
  const maxRowid = getMaxMessageRowid();
  return c.json({ maxRowid });
});

export default messages;
