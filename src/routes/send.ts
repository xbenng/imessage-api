import { Hono } from "hono";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const send = new Hono();

const UPLOAD_DIR = path.join(os.tmpdir(), "imessage-api-uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
      const ext = path.extname(file.name) || "";
      const tmpName = `upload-${Date.now()}${ext}`;
      attachmentPath = path.join(UPLOAD_DIR, tmpName);
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
    if (attachmentPath) {
      try { fs.unlinkSync(attachmentPath); } catch {}
    }
  }
});

export default send;
