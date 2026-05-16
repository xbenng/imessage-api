import { Hono } from "hono";
import { getChats, getChatById, getChatByGuid } from "../lib/queries.js";

const chats = new Hono();

chats.get("/", (c) => {
  const limit = parseInt(c.req.query("limit") || "100", 10);
  const data = getChats(Math.min(limit, 500));
  return c.json(data);
});

chats.get("/:id", (c) => {
  const idParam = c.req.param("id");
  const numericId = parseInt(idParam, 10);

  let chat;
  if (!isNaN(numericId) && String(numericId) === idParam) {
    chat = getChatById(numericId);
  } else {
    chat = getChatByGuid(decodeURIComponent(idParam));
  }

  if (!chat) return c.json({ error: "Chat not found" }, 404);
  return c.json(chat);
});

export default chats;
