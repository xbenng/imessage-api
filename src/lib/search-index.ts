import { getChatDb, getIndexDb } from "./db.js";
import { extractTextFromAttributedBody } from "./attributed-body.js";

const BATCH_SIZE = 5000;

export function buildSearchIndex(): { indexed: number; skipped: number } {
  const chatDb = getChatDb();
  const indexDb = getIndexDb();

  const stateRow = indexDb
    .prepare("SELECT value FROM sync_state WHERE key = ?")
    .get("last_indexed_rowid") as { value: number } | undefined;
  const lastRowid = stateRow?.value ?? 0;

  const selectStmt = chatDb.prepare(
    "SELECT ROWID, attributedBody FROM message WHERE ROWID > ? AND attributedBody IS NOT NULL ORDER BY ROWID LIMIT ?"
  );
  const insertStmt = indexDb.prepare(
    "INSERT OR IGNORE INTO message_text (rowid, text) VALUES (?, ?)"
  );
  const updateState = indexDb.prepare(
    "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)"
  );

  let indexed = 0;
  let skipped = 0;
  let cursor = lastRowid;

  while (true) {
    const rows = selectStmt.all(cursor, BATCH_SIZE) as Array<{
      ROWID: number;
      attributedBody: Buffer;
    }>;
    if (rows.length === 0) break;

    const insertMany = indexDb.transaction(() => {
      for (const row of rows) {
        const text = extractTextFromAttributedBody(row.attributedBody);
        if (text && text.trim().length > 0) {
          insertStmt.run(row.ROWID, text);
          indexed++;
        } else {
          skipped++;
        }
        cursor = row.ROWID;
      }
      updateState.run("last_indexed_rowid", cursor);
    });
    insertMany();
  }

  return { indexed, skipped };
}

export function searchMessages(
  query: string,
  limit: number = 50
): number[] {
  const indexDb = getIndexDb();

  // Sanitize query for FTS5: wrap each word in quotes to prevent syntax errors
  const sanitized = query
    .replace(/['"]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w}"`)
    .join(" ");

  if (!sanitized) return [];

  const rows = indexDb
    .prepare(
      `
    SELECT rowid
    FROM message_fts
    WHERE message_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `
    )
    .all(sanitized, limit) as Array<{ rowid: number }>;

  return rows.map((r) => r.rowid);
}
