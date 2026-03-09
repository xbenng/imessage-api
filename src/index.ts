import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { corsMiddleware } from "./middleware/cors.js";
import { authMiddleware } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import chatsRoutes from "./routes/chats.js";
import messagesRoutes from "./routes/messages.js";
import searchRoutes from "./routes/search.js";
import attachmentsRoutes from "./routes/attachments.js";
import contactsRoutes from "./routes/contacts.js";
import sendRoutes from "./routes/send.js";
import { buildSearchIndex } from "./lib/search-index.js";
import { loadContacts } from "./lib/contacts.js";
import { getChatDb } from "./lib/db.js";

const app = new Hono();

// Global middleware
app.use("*", corsMiddleware);

// Public routes
app.route("/auth", authRoutes);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Protected routes
app.use("/chats/*", authMiddleware);
app.use("/messages/*", authMiddleware);
app.use("/search/*", authMiddleware);
app.use("/attachments/*", authMiddleware);
app.use("/contacts/*", authMiddleware);
app.use("/send/*", authMiddleware);

app.route("/chats", chatsRoutes);
app.route("/", messagesRoutes); // mounts /chats/:id/messages and /messages/*
app.route("/search", searchRoutes);
app.route("/attachments", attachmentsRoutes);
app.route("/contacts", contactsRoutes);
app.route("/send", sendRoutes);

// Startup
const PORT = parseInt(process.env.PORT || "3001", 10);

async function startup() {
  // Verify database access
  try {
    const db = getChatDb();
    const row = db.prepare("SELECT COUNT(*) as cnt FROM message").get() as { cnt: number };
    console.log(`Database connected: ${row.cnt} messages`);
  } catch (err) {
    console.error("Failed to open chat.db. Make sure Full Disk Access is granted.");
    console.error(err);
    process.exit(1);
  }

  // Load contacts
  console.log("Loading contacts...");
  const contacts = loadContacts();
  console.log(`Loaded ${Object.keys(contacts).length} contact entries`);

  // Build search index
  console.log("Building search index...");
  const indexResult = buildSearchIndex();
  console.log(`Search index: ${indexResult.indexed} indexed, ${indexResult.skipped} skipped`);

  // Periodic re-index every 30 seconds
  setInterval(() => {
    const result = buildSearchIndex();
    if (result.indexed > 0) {
      console.log(`Re-indexed ${result.indexed} new messages`);
    }
  }, 30000);

  // Start server
  serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, () => {
    console.log(`iMessage API running on http://localhost:${PORT}`);
  });
}

startup();
