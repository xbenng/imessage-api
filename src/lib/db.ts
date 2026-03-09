import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

const CHAT_DB_PATH = path.join(os.homedir(), "Library", "Messages", "chat.db");
const DATA_DIR = path.join(process.cwd(), "data");
const INDEX_DB_PATH = path.join(DATA_DIR, "index.db");

let chatDb: Database.Database | null = null;
let indexDb: Database.Database | null = null;

export function getChatDb(): Database.Database {
  if (!chatDb) {
    chatDb = new Database(CHAT_DB_PATH, {
      readonly: true,
      fileMustExist: true,
    });
    chatDb.pragma("journal_mode = WAL");
  }
  return chatDb;
}

export function getIndexDb(): Database.Database {
  if (!indexDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    indexDb = new Database(INDEX_DB_PATH);
    indexDb.pragma("journal_mode = WAL");
    initializeIndexDb(indexDb);
  }
  return indexDb;
}

function initializeIndexDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_text (
      rowid INTEGER PRIMARY KEY,
      text TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
      text,
      content='message_text',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS message_text_ai AFTER INSERT ON message_text BEGIN
      INSERT INTO message_fts(rowid, text) VALUES (new.rowid, new.text);
    END;

    CREATE TRIGGER IF NOT EXISTS message_text_ad AFTER DELETE ON message_text BEGIN
      INSERT INTO message_fts(message_fts, rowid, text) VALUES('delete', old.rowid, old.text);
    END;

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value INTEGER
    );
  `);
}

export function closeDatabases(): void {
  chatDb?.close();
  indexDb?.close();
  chatDb = null;
  indexDb = null;
}
