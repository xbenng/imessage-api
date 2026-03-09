import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

const AUTH_SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "default-secret-change-me-immediately"
);
const AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH || "";

export async function verifyPassword(password: string): Promise<boolean> {
  if (!AUTH_PASSWORD_HASH) return false;
  return bcrypt.compare(password, AUTH_PASSWORD_HASH);
}

export async function createToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(AUTH_SECRET);
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, AUTH_SECRET);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hash a password for storing in .env
 * Usage: node -e "import('./src/lib/auth.js').then(m => m.hashPassword('yourpass').then(console.log))"
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
