import { timingSafeEqual } from "node:crypto";

// Kept out of session.ts on purpose: middleware runs on the edge runtime
// and imports sessionOptions from there, where node:crypto is unavailable.
export function checkPassword(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("APP_PASSWORD is not set");
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
