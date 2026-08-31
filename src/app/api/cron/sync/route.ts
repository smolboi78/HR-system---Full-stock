import { NextRequest, NextResponse } from "next/server";
import { syncBranches, syncEmployees, syncAttendance, syncVisits } from "@/lib/sync";

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

  const steps: string[] = [];
  try {
    steps.push("syncBranches");
    await syncBranches();
    steps.push("syncEmployees");
    await syncEmployees();
    steps.push("syncAttendance");
    await syncAttendance(range);
    steps.push("syncVisits");
    await syncVisits({ from: from.toISOString(), to: to.toISOString() });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        failedAt: steps[steps.length - 1],
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, range });
}
