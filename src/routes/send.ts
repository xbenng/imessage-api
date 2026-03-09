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

  const escapedTo = escapeAppleScript(to);
  const serviceName = service === "SMS" ? "SMS" : "iMessage";

  try {
    // Send text if provided
    if (text) {
      const escapedText = escapeAppleScript(text);
      const textScript = `
tell application "Messages"
  set targetService to 1st account whose service type = ${serviceName}
  set targetBuddy to participant "${escapedTo}" of targetService
  send "${escapedText}" to targetBuddy
end tell
`;
      execSync(`osascript -e '${textScript.replace(/'/g, "'\\''")}'`, { timeout: 15000 });
    }

    // Send attachment if provided
    if (attachmentPath) {
      const escapedPath = escapeAppleScript(attachmentPath);
      const fileScript = `
tell application "Messages"
  set targetService to 1st account whose service type = ${serviceName}
  set targetBuddy to participant "${escapedTo}" of targetService
  send POSIX file "${escapedPath}" to targetBuddy
end tell
`;
      execSync(`osascript -e '${fileScript.replace(/'/g, "'\\''")}'`, { timeout: 30000 });
    }

    return c.json({ success: true });
  } catch (err: any) {
    console.error("Failed to send message:", err.stderr?.toString() || err.message);
    return c.json({ error: "Failed to send message", detail: err.stderr?.toString() || err.message }, 500);
  } finally {
    // Clean up temp file
    if (attachmentPath) {
      try { fs.unlinkSync(attachmentPath); } catch {}
    }
  }
});

export default send;
