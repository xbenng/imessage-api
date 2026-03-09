import { Hono } from "hono";
import { getAttachmentById } from "../lib/queries.js";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { stream } from "hono/streaming";

const attachments = new Hono();

const MESSAGES_DIR = path.join(os.homedir(), "Library", "Messages");

// MIME types that browsers can't display natively — convert to JPEG via macOS sips
const NEEDS_CONVERSION = new Set([
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/x-adobe-dng",
]);

function convertToJpeg(sourcePath: string): Buffer {
  const tmpOut = path.join(os.tmpdir(), `imessage-convert-${Date.now()}.jpg`);
  try {
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", sourcePath, "--out", tmpOut], {
      timeout: 10000,
    });
    return fs.readFileSync(tmpOut);
  } finally {
    try { fs.unlinkSync(tmpOut); } catch {}
  }
}

attachments.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid attachment ID" }, 400);

  const attachment = getAttachmentById(id);
  if (!attachment || !attachment.filename) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  // Expand ~ to home directory
  const filePath = attachment.filename.replace(/^~/, os.homedir());
  const resolved = path.resolve(filePath);

  // Security: prevent path traversal — allow Messages dir and temp dirs (where some attachments live)
  const allowedPrefixes = [
    MESSAGES_DIR,
    "/private/var/folders/",
    path.join(os.homedir(), "Library", "Messages"),
  ];
  const allowed = allowedPrefixes.some((prefix) => resolved.startsWith(prefix));
  if (!allowed) {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (!fs.existsSync(resolved)) {
    return c.json({ error: "File not found on disk" }, 404);
  }

  const stat = fs.statSync(resolved);
  const mimeType = attachment.mimeType || "application/octet-stream";

  // Convert browser-incompatible image formats to JPEG using macOS sips
  if (NEEDS_CONVERSION.has(mimeType)) {
    try {
      const converted = convertToJpeg(resolved);
      return new Response(converted, {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": converted.length.toString(),
          "Cache-Control": "private, max-age=86400",
        },
      });
    } catch {
      return c.json({ error: "Failed to convert image" }, 500);
    }
  }

  // For small files (<10MB), read into memory
  if (stat.size < 10 * 1024 * 1024) {
    const buffer = fs.readFileSync(resolved);
    return new Response(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": stat.size.toString(),
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  // For larger files, stream
  const nodeStream = fs.createReadStream(resolved);
  return stream(c, async (s) => {
    c.header("Content-Type", mimeType);
    c.header("Content-Length", stat.size.toString());
    c.header("Cache-Control", "private, max-age=86400");

    for await (const chunk of nodeStream) {
      await s.write(chunk);
    }
  });
});

export default attachments;
