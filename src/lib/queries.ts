import { getChatDb } from "./db.js";
import { cocoaNsToUnixMs } from "./timestamps.js";
import { extractTextFromAttributedBody } from "./attributed-body.js";
import { resolveContactName } from "./contacts.js";
import type { Chat, Message, Attachment, Participant, Tapback } from "../types/index.js";

// ---- Chats ----

export function getChats(limit: number = 100): Chat[] {
  const db = getChatDb();
  const rows = db
    .prepare(
      `
    SELECT
      c.ROWID as id,
      c.guid,
      c.chat_identifier,
      c.style,
      c.display_name,
      c.service_name,
      MAX(cmj.message_date) as last_message_date,
      COUNT(cmj.message_id) as message_count
    FROM chat c
    JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
    GROUP BY c.ROWID
    ORDER BY last_message_date DESC
    LIMIT ?
  `
    )
    .all(limit) as any[];

  return rows.map((row) => enrichChat(row));
}

export function getChatById(chatId: number): Chat | null {
  const db = getChatDb();
  const row = db
    .prepare(
      `
    SELECT
      c.ROWID as id,
      c.guid,
      c.chat_identifier,
      c.style,
      c.display_name,
      c.service_name,
      MAX(cmj.message_date) as last_message_date,
      COUNT(cmj.message_id) as message_count
    FROM chat c
    JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
    WHERE c.ROWID = ?
    GROUP BY c.ROWID
  `
    )
    .get(chatId) as any | undefined;

  if (!row) return null;
  return enrichChat(row);
}

export function getChatByGuid(guid: string): Chat | null {
  const db = getChatDb();
  const row = db
    .prepare(
      `
    SELECT
      c.ROWID as id,
      c.guid,
      c.chat_identifier,
      c.style,
      c.display_name,
      c.service_name,
      MAX(cmj.message_date) as last_message_date,
      COUNT(cmj.message_id) as message_count
    FROM chat c
    JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
    WHERE c.guid = ?
    GROUP BY c.ROWID
  `
    )
    .get(guid) as any | undefined;

  if (!row) return null;
  return enrichChat(row);
}

export function getMessagesByChatGuid(
  guid: string,
  beforeRowid?: number,
  limit: number = 50
): Message[] {
  const db = getChatDb();
  const chatRow = db
    .prepare("SELECT ROWID FROM chat WHERE guid = ?")
    .get(guid) as any | undefined;
  if (!chatRow) return [];
  return getMessages(chatRow.ROWID, beforeRowid, limit);
}

function enrichChat(row: any): Chat {
  const participants = getChatParticipants(row.id);
  const lastMessage = getLastMessagePreview(row.id);

  // Determine display name
  let displayName = row.display_name;
  if (!displayName) {
    if (participants.length === 1) {
      displayName = participants[0].displayName;
    } else if (participants.length > 1) {
      displayName = participants.map((p) => p.displayName.split(" ")[0]).join(", ");
    } else {
      displayName = row.chat_identifier;
    }
  }

  return {
    id: row.id,
    guid: row.guid,
    chatIdentifier: row.chat_identifier,
    style: row.style,
    displayName,
    serviceName: row.service_name || "iMessage",
    participants,
    lastMessageDate: cocoaNsToUnixMs(row.last_message_date),
    lastMessagePreview: lastMessage || "",
    messageCount: row.message_count,
  };
}

function getChatParticipants(chatId: number): Participant[] {
  const db = getChatDb();
  const rows = db
    .prepare(
      `
    SELECT h.id as handle_id, h.service
    FROM handle h
    JOIN chat_handle_join chj ON chj.handle_id = h.ROWID
    WHERE chj.chat_id = ?
  `
    )
    .all(chatId) as any[];

  return rows.map((row) => ({
    handleId: row.handle_id,
    displayName: resolveContactName(row.handle_id),
    service: row.service,
  }));
}

function getLastMessagePreview(chatId: number): string | null {
  const db = getChatDb();
  const row = db
    .prepare(
      `
    SELECT m.text, m.attributedBody
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    WHERE cmj.chat_id = ? AND m.associated_message_type = 0
    ORDER BY m.date DESC
    LIMIT 1
  `
    )
    .get(chatId) as any | undefined;

  if (!row) return null;
  let text = row.text;
  if (!text && row.attributedBody) {
    text = extractTextFromAttributedBody(row.attributedBody);
  }
  if (text && text.length > 100) {
    text = text.substring(0, 100) + "...";
  }
  return text;
}

// ---- Messages ----

export function getMessages(
  chatId: number,
  beforeRowid?: number,
  limit: number = 50
): Message[] {
  const db = getChatDb();

  let sql = `
    SELECT
      m.ROWID as id,
      m.guid,
      m.text,
      m.attributedBody,
      m.is_from_me,
      m.date,
      m.date_read,
      m.date_delivered,
      m.handle_id as handle_rowid,
      m.associated_message_type,
      m.associated_message_guid,
      m.cache_has_attachments,
      m.is_audio_message,
      m.expressive_send_style_id,
      m.thread_originator_guid,
      m.service,
      h.id as handle_id,
      cmj.chat_id
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    WHERE cmj.chat_id = ?
  `;
  const params: any[] = [chatId];

  if (beforeRowid) {
    sql += " AND m.ROWID < ?";
    params.push(beforeRowid);
  }

  sql += " ORDER BY m.date DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as any[];

  // Separate tapbacks from regular messages
  const tapbackRows: any[] = [];
  const messageRows: any[] = [];

  for (const row of rows) {
    if (row.associated_message_type >= 2000 && row.associated_message_type <= 2005) {
      tapbackRows.push(row);
    } else {
      messageRows.push(row);
    }
  }

  // Build tapback map keyed by target message guid
  const tapbackMap = new Map<string, Tapback[]>();
  for (const tb of tapbackRows) {
    // associated_message_guid format: "p:0/GUID" or "bp:GUID"
    let targetGuid = tb.associated_message_guid || "";
    const slashIdx = targetGuid.indexOf("/");
    if (slashIdx !== -1) {
      targetGuid = targetGuid.substring(slashIdx + 1);
    }

    const existing = tapbackMap.get(targetGuid) || [];
    existing.push({
      type: tb.associated_message_type,
      isFromMe: !!tb.is_from_me,
      senderName: tb.is_from_me ? "You" : resolveContactName(tb.handle_id || ""),
      associatedMessageGuid: targetGuid,
    });
    tapbackMap.set(targetGuid, existing);
  }

  // Enrich messages and attach tapbacks
  const messages = messageRows.map((row) => {
    const msg = enrichMessage(row);
    msg.tapbacks = tapbackMap.get(row.guid) || [];
    return msg;
  });

  // Return in chronological order
  return messages.reverse();
}

export function getMessagesByRowids(rowids: number[]): any[] {
  if (rowids.length === 0) return [];
  const db = getChatDb();
  const placeholders = rowids.map(() => "?").join(",");
  return db
    .prepare(
      `
    SELECT
      m.ROWID as id, m.guid, m.text, m.attributedBody,
      m.is_from_me, m.date, m.handle_id as handle_rowid,
      m.associated_message_type, m.cache_has_attachments,
      m.service,
      h.id as handle_id,
      cmj.chat_id
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    WHERE m.ROWID IN (${placeholders})
    ORDER BY m.date DESC
  `
    )
    .all(...rowids) as any[];
}

export function getNewMessagesSince(lastRowid: number, limit: number = 200): Message[] {
  const db = getChatDb();
  const rows = db
    .prepare(
      `
    SELECT
      m.ROWID as id,
      m.guid,
      m.text,
      m.attributedBody,
      m.is_from_me,
      m.date,
      m.date_read,
      m.date_delivered,
      m.handle_id as handle_rowid,
      m.associated_message_type,
      m.associated_message_guid,
      m.cache_has_attachments,
      m.is_audio_message,
      m.expressive_send_style_id,
      m.thread_originator_guid,
      m.service,
      h.id as handle_id,
      cmj.chat_id
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    WHERE m.ROWID > ?
    ORDER BY m.ROWID ASC
    LIMIT ?
  `
    )
    .all(lastRowid, limit) as any[];

  return rows.map((row) => enrichMessage(row));
}

export function getMaxMessageRowid(): number {
  const db = getChatDb();
  const row = db.prepare("SELECT MAX(ROWID) as maxId FROM message").get() as {
    maxId: number;
  };
  return row.maxId || 0;
}

// ---- Attachments ----

export function getAttachmentsForMessage(messageRowid: number): Attachment[] {
  const db = getChatDb();
  const rows = db
    .prepare(
      `
    SELECT
      a.ROWID as id,
      a.filename,
      a.mime_type,
      a.total_bytes,
      a.transfer_name,
      a.is_sticker,
      a.transfer_state
    FROM attachment a
    JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
    WHERE maj.message_id = ?
  `
    )
    .all(messageRowid) as any[];

  return rows
    .filter((r) => r.transfer_state === 0 || r.transfer_state === 5)
    .map((row) => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mime_type,
      totalBytes: row.total_bytes || 0,
      transferName: row.transfer_name,
      isSticker: !!row.is_sticker,
    }));
}

export function getAttachmentById(
  attachmentId: number
): { id: number; filename: string; mimeType: string; totalBytes: number } | null {
  const db = getChatDb();
  const row = db
    .prepare(
      `
    SELECT ROWID as id, filename, mime_type, total_bytes, transfer_state
    FROM attachment WHERE ROWID = ?
  `
    )
    .get(attachmentId) as any | undefined;

  if (!row || (row.transfer_state !== 0 && row.transfer_state !== 5)) return null;
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    totalBytes: row.total_bytes || 0,
  };
}

// ---- Helpers ----

function enrichMessage(row: any): Message {
  let text = row.text;
  if (!text && row.attributedBody) {
    text = extractTextFromAttributedBody(row.attributedBody);
  }

  const isFromMe = !!row.is_from_me;
  const handleId = row.handle_id || null;

  return {
    id: row.id,
    guid: row.guid,
    text,
    isFromMe,
    date: cocoaNsToUnixMs(row.date),
    dateRead: cocoaNsToUnixMs(row.date_read),
    dateDelivered: cocoaNsToUnixMs(row.date_delivered),
    handleId,
    senderName: isFromMe ? "You" : resolveContactName(handleId || ""),
    chatId: row.chat_id,
    associatedMessageType: row.associated_message_type || 0,
    associatedMessageGuid: row.associated_message_guid || null,
    threadOriginatorGuid: row.thread_originator_guid || null,
    attachments: row.cache_has_attachments ? getAttachmentsForMessage(row.id) : [],
    tapbacks: [],
    isAudioMessage: !!row.is_audio_message,
    expressiveSendStyleId: row.expressive_send_style_id || null,
    service: row.service || null,
  };
}
