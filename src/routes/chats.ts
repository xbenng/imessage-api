import { Hono } from "hono";
import { getChats, getChatById } from "../lib/queries.js";

const chats = new Hono();

chats.get("/", (c) => {
  const limit = parseInt(c.req.query("limit") || "100", 10);
  const data = getChats(Math.min(limit, 500));
  return c.json(data);
});

chats.get("/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid chat ID" }, 400);

  const chat = getChatById(id);
  if (!chat) return c.json({ error: "Chat not found" }, 404);
  return c.json(chat);
});

export default chats;
