import { Hono } from "hono";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const send = new Hono();

// Uploads are staged where Messages can read them. Files under the server's
// own temp dir (os.tmpdir() -> /var/folders/.../T) fail to send: Messages
// records the attachment with error 25 and only the caption goes out.
// Messages also reads the file after `send` returns, so staged files are
// removed later rather than immediately.
const UPLOAD_DIR = path.join(os.homedir(), "Pictures", "imessage-api-outbox");
const UPLOAD_TTL_MS = 10 * 60 * 1000;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function removeLater(dir: string) {
  setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), UPLOAD_TTL_MS).unref();
}

// Sweep anything left behind by a previous run.
for (const entry of fs.readdirSync(UPLOAD_DIR)) {
  const p = path.join(UPLOAD_DIR, entry);
  try {
    if (Date.now() - fs.statSync(p).mtimeMs > UPLOAD_TTL_MS) fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

/** Keep the sender's filename (the recipient sees it), minus anything path-like. */
function safeFileName(name: string): string {
  const base = path.basename(name || "").replace(/[\x00-\x1f/\\:]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base : "attachment";
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isChatId(to: string): boolean {
  // Chat IDs look like "iMessage;-;+15551234567", "SMS;-;+15551234567",
  // "any;+;<guid>", or "any;-;<guid>".
  return /^(iMessage|SMS|any);[+-];/.test(to);
}

function runOsa(script: string, timeoutMs: number) {
  execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: timeoutMs });
}

function buildTextScript(to: string, text: string, service: string): string {
  const escTo = escapeAppleScript(to);
  const escText = escapeAppleScript(text);
  if (isChatId(to)) {
    return `
tell application "Messages"
  send "${escText}" to chat id "${escTo}"
end tell
`;
  }
  return `
tell application "Messages"
  set targetService to 1st account whose service type = ${service}
  set targetBuddy to participant "${escTo}" of targetService
  send "${escText}" to targetBuddy
end tell
`;
}

function buildFileScript(to: string, filePath: string, service: string): string {
  const escTo = escapeAppleScript(to);
  const escPath = escapeAppleScript(filePath);
  if (isChatId(to)) {
    return `
set theFile to POSIX file "${escPath}" as alias
tell application "Messages"
  send theFile to chat id "${escTo}"
end tell
`;
  }
  return `
set theFile to POSIX file "${escPath}" as alias
tell application "Messages"
  set targetService to 1st account whose service type = ${service}
  set targetBuddy to participant "${escTo}" of targetService
  send theFile to targetBuddy
end tell
`;
}

send.post("/", async (c) => {
  const contentType = c.req.header("content-type") || "";

  let to: string;
  let text: string | undefined;
  let service: string;
  let attachmentPath: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    to = (form["to"] as string) || "";
    text = (form["text"] as string) || undefined;
    service = (form["service"] as string) || "iMessage";

    const file = form["attachment"];
    if (file && file instanceof File) {
      // One directory per upload so the original filename can be kept.
      const dir = fs.mkdtempSync(path.join(UPLOAD_DIR, "upload-"));
      attachmentPath = path.join(dir, safeFileName(file.name));
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(attachmentPath, buffer);
    }
  } else {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "Invalid request" }, 400);
    to = body.to || "";
    text = body.text || undefined;
    service = body.service || "iMessage";
  }

  if (!to) return c.json({ error: "\"to\" is required" }, 400);
  if (!text && !attachmentPath) return c.json({ error: "\"text\" or attachment is required" }, 400);

  const serviceName = service === "SMS" ? "SMS" : "iMessage";

  try {
    if (text) {
      runOsa(buildTextScript(to, text, serviceName), 15000);
    }
    if (attachmentPath) {
      runOsa(buildFileScript(to, attachmentPath, serviceName), 30000);
    }
    return c.json({ success: true });
  } catch (err: any) {
    console.error("Failed to send message:", err.stderr?.toString() || err.message);
    return c.json({ error: "Failed to send message", detail: err.stderr?.toString() || err.message }, 500);
  } finally {
    if (attachmentPath) removeLater(path.dirname(attachmentPath));
  }
});

export default send;
