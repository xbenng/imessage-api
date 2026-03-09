import type { MiddlewareHandler } from "hono";
import { verifyToken } from "../lib/auth.js";

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  const valid = await verifyToken(token);
  if (!valid) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  await next();
};
