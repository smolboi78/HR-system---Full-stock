import { NextRequest, NextResponse } from "next/server";
import { syncBranches, syncEmployees, syncAttendance } from "@/lib/sync";

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

// Re-pulls a trailing window (not just "today") so that late punches,
// corrections, or missed syncs get picked up automatically.
const SYNC_WINDOW_DAYS = 10;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - SYNC_WINDOW_DAYS);

  const range = {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };

  await syncBranches();
  await syncEmployees();
  await syncAttendance(range);

  return NextResponse.json({ ok: true, range });
}
