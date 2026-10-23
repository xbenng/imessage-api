import { Hono } from "hono";
import { getAttachmentById } from "../lib/queries.js";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { stream } from "hono/streaming";

const attachments = new Hono();

const MESSAGES_DIR = path.join(os.homedir(), "Library", "Messages");

/**
 * Resolve a path for comparison. On macOS /var, /tmp and /etc are symlinks into
 * /private, and chat.db stores the unresolved form (/var/folders/...), so a raw
 * string prefix check against "/private/var/folders/" never matches. Resolve
 * symlinks when the file exists; fall back to rewriting the well-known firmlink
 * prefixes when it does not (macOS purges the imagent temp dirs aggressively).
 */
function canonicalPath(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    for (const link of ["/var", "/tmp", "/etc"]) {
      if (resolved === link || resolved.startsWith(link + path.sep)) {
        return "/private" + resolved;
      }
    }
    return resolved;
  }
}

/** Boundary-aware containment check ("/a/bc" is not inside "/a/b"). */
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// Roots an attachment is allowed to be served from. Messages stores most files
// under ~/Library/Messages/Attachments, but files still in transit (and many
// screenshots) live in imagent's per-user temp dir under /var/folders.
const ALLOWED_ROOTS = [MESSAGES_DIR, "/var/folders"].map(canonicalPath);
const TEMP_ROOT = canonicalPath("/var/folders");

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
  const resolved = canonicalPath(filePath);

  // Security: prevent path traversal — only serve files under the allowed roots
  if (!ALLOWED_ROOTS.some((root) => isInside(resolved, root))) {
    return c.json(
      {
        error: "Forbidden",
        message:
          "Attachment is stored outside the directories this server is allowed to read " +
          "(~/Library/Messages and the Messages temporary directory).",
      },
      403
    );
  }

  if (!fs.existsSync(resolved)) {
    return c.json(
      {
        error: "File not found on disk",
        message: isInside(resolved, TEMP_ROOT)
          ? "The attachment was never copied into the Messages library — it only existed in " +
            "macOS temporary storage, which has since been purged, so the file is unrecoverable."
          : "The attachment is listed in chat.db but the file is missing from disk.",
      },
      404
    );
  }

  const stat = fs.statSync(resolved);
  const mimeType = attachment.mimeType || "application/octet-stream";

  // Convert browser-incompatible image formats to JPEG using macOS sips
  if (NEEDS_CONVERSION.has(mimeType)) {
    try {
      const converted = convertToJpeg(resolved);
      return new Response(converted as unknown as BodyInit, {
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
