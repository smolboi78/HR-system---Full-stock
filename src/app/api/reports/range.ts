import { NextRequest } from "next/server";

export function parseRange(req: NextRequest): { from: Date; to: Date } {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) {
    throw new Error("Query params 'from' and 'to' (YYYY-MM-DD) are required");
  }
  return { from: new Date(from), to: new Date(to) };
}
