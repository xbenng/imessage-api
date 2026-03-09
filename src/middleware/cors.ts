import { cors } from "hono/cors";

const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

export const corsMiddleware = cors({
  origin: CORS_ORIGIN.split(",").map((o) => o.trim()),
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
});
