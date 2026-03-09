import { Hono } from "hono";
import { z } from "zod";
import { verifyPassword, createToken } from "../lib/auth.js";

const auth = new Hono();

const loginSchema = z.object({
  password: z.string().min(1),
});

auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Password is required" }, 400);
  }

  const valid = await verifyPassword(parsed.data.password);
  if (!valid) {
    return c.json({ error: "Invalid password" }, 401);
  }

  const token = await createToken();
  return c.json({ token });
});

export default auth;
