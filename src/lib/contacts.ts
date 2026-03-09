import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";
import type { ContactMap } from "../types/index.js";

const ADDRESSBOOK_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "AddressBook"
);
const CACHE_PATH = path.join(process.cwd(), "data", "contacts-cache.json");
const CACHE_TTL_MS = 3600000; // 1 hour

let contactMap: ContactMap | null = null;
let cacheTimestamp = 0;

/**
 * Find all AddressBook SQLite databases (main + per-source).
 * Each iCloud/Google/local account has its own source DB.
 */
function findAddressBookDbs(): string[] {
  const dbs: string[] = [];

  const mainDb = path.join(ADDRESSBOOK_DIR, "AddressBook-v22.abcddb");
  if (fs.existsSync(mainDb)) dbs.push(mainDb);

  const sourcesDir = path.join(ADDRESSBOOK_DIR, "Sources");
  if (fs.existsSync(sourcesDir)) {
    for (const entry of fs.readdirSync(sourcesDir)) {
      const sourceDb = path.join(sourcesDir, entry, "AddressBook-v22.abcddb");
      if (fs.existsSync(sourceDb)) dbs.push(sourceDb);
    }
  }

  return dbs;
}

/**
 * Read contacts from a single AddressBook database.
 * Extracts phone numbers and email addresses mapped to display names.
 */
function readContactsFromDb(dbPath: string): Record<string, string> {
  const result: Record<string, string> = {};

  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma("journal_mode = WAL");
  } catch {
    return result;
  }

  try {
    // Phone numbers
    const phones = db
      .prepare(
        `
      SELECT r.ZFIRSTNAME, r.ZLASTNAME, p.ZFULLNUMBER
      FROM ZABCDRECORD r
      JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
      WHERE p.ZFULLNUMBER IS NOT NULL
        AND (r.ZFIRSTNAME IS NOT NULL OR r.ZLASTNAME IS NOT NULL)
    `
      )
      .all() as Array<{
      ZFIRSTNAME: string | null;
      ZLASTNAME: string | null;
      ZFULLNUMBER: string;
    }>;

    for (const row of phones) {
      const name = [row.ZFIRSTNAME, row.ZLASTNAME].filter(Boolean).join(" ");
      if (name) result[row.ZFULLNUMBER] = name;
    }

    // Email addresses
    const emails = db
      .prepare(
        `
      SELECT r.ZFIRSTNAME, r.ZLASTNAME, e.ZADDRESS
      FROM ZABCDRECORD r
      JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
      WHERE e.ZADDRESS IS NOT NULL
        AND (r.ZFIRSTNAME IS NOT NULL OR r.ZLASTNAME IS NOT NULL)
    `
      )
      .all() as Array<{
      ZFIRSTNAME: string | null;
      ZLASTNAME: string | null;
      ZADDRESS: string;
    }>;

    for (const row of emails) {
      const name = [row.ZFIRSTNAME, row.ZLASTNAME].filter(Boolean).join(" ");
      if (name) result[row.ZADDRESS] = name;
    }
  } catch (err) {
    console.warn(`Failed to read contacts from ${dbPath}:`, err);
  } finally {
    db.close();
  }

  return result;
}

/**
 * Normalize a phone number to the format used by chat.db handles (+1XXXXXXXXXX).
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw;
}

export function loadContacts(): ContactMap {
  if (contactMap && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return contactMap;
  }

  // Try loading from cache file
  if (fs.existsSync(CACHE_PATH)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
      if (cached._timestamp && Date.now() - cached._timestamp < CACHE_TTL_MS) {
        const ts = cached._timestamp;
        delete cached._timestamp;
        contactMap = cached;
        cacheTimestamp = ts;
        return contactMap;
      }
    } catch {
      // Cache corrupted, rebuild
    }
  }

  // Read from all AddressBook databases
  const rawMap: Record<string, string> = {};
  const dbs = findAddressBookDbs();
  console.log(`Found ${dbs.length} AddressBook databases`);

  for (const dbPath of dbs) {
    const entries = readContactsFromDb(dbPath);
    Object.assign(rawMap, entries);
  }

  // Build normalized map: store both raw and normalized versions
  const normalized: ContactMap = {};
  for (const [key, value] of Object.entries(rawMap)) {
    // Store the raw key (e.g., "(415) 228-3183", "user@email.com")
    normalized[key] = value;
    // Also store normalized phone version (e.g., "+14152283183")
    const norm = normalizePhone(key);
    if (norm !== key) {
      normalized[norm] = value;
    }
    // Store lowercase email for case-insensitive matching
    if (key.includes("@")) {
      normalized[key.toLowerCase()] = value;
    }
  }

  console.log(
    `Loaded ${Object.keys(rawMap).length} raw contacts → ${Object.keys(normalized).length} entries (with normalized variants)`
  );

  // Save cache
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(
    CACHE_PATH,
    JSON.stringify({ ...normalized, _timestamp: Date.now() }, null, 2)
  );

  contactMap = normalized;
  cacheTimestamp = Date.now();
  return contactMap;
}

export function resolveContactName(handleId: string): string {
  if (!handleId) return "Unknown";

  const map = loadContacts();

  // Direct lookup
  if (map[handleId]) return map[handleId];

  // Normalized phone lookup
  const norm = normalizePhone(handleId);
  if (map[norm]) return map[norm];

  // Try digits-only matching for edge cases
  const digits = handleId.replace(/\D/g, "");
  if (digits.length >= 10) {
    const withPlus1 = `+1${digits.slice(-10)}`;
    if (map[withPlus1]) return map[withPlus1];
  }

  // Case-insensitive email lookup
  if (handleId.includes("@")) {
    const lower = handleId.toLowerCase();
    if (map[lower]) return map[lower];
  }

  // Format phone number for display as fallback
  if (handleId.startsWith("+1") && handleId.length === 12) {
    const d = handleId.slice(2);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }

  return handleId;
}

export function getContactMap(): ContactMap {
  return loadContacts();
}
