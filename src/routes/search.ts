import { Hono } from "hono";
import { searchMessages } from "../lib/search-index.js";
import { getMessagesByRowids } from "../lib/queries.js";
import { cocoaNsToUnixMs } from "../lib/timestamps.js";
import { extractTextFromAttributedBody } from "../lib/attributed-body.js";
import { resolveContactName } from "../lib/contacts.js";
import type { SearchResult } from "../types/index.js";

const search = new Hono();

search.get("/", (c) => {
  const query = c.req.query("q");
  if (!query || query.trim().length === 0) {
    return c.json({ error: "Query parameter 'q' is required" }, 400);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  const rowids = searchMessages(query.trim(), limit);

  if (rowids.length === 0) {
    return c.json([]);
  }

  const rows = getMessagesByRowids(rowids);

  const results: SearchResult[] = rows.map((row: any) => {
    let text = row.text;
    if (!text && row.attributedBody) {
      text = extractTextFromAttributedBody(row.attributedBody);
    }

    return {
      messageId: row.id,
      text: text || "",
      chatId: row.chat_id,
      chatDisplayName: row.chat_display_name || row.chat_identifier || "",
      senderName: row.is_from_me ? "You" : resolveContactName(row.handle_id || ""),
      isFromMe: !!row.is_from_me,
      date: cocoaNsToUnixMs(row.date),
    };
  });

  return c.json(results);
});

export default search;
