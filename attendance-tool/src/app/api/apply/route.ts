import { NextResponse } from "next/server";
import { z } from "zod";
import { applyRows } from "@/lib/apply";
import { requireUser, UnauthorisedError } from "@/lib/session";

const Row = z.object({
  employmentNumber: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reasonCode: z.string().min(1),
  bucket: z.enum(["EMERGENCY", "ANNUAL", "UNPAID", "BUSINESS_MISSION", "NONE"]).optional(),
  hours: z.number().min(0).max(24).optional(),
  note: z.string().max(500).optional(),
});

// Batch apply sends many rows in one call; one bad row fails alone and the
// response says which.
const Body = z.object({ rows: z.array(Row).min(1).max(200) });

// Vercel caps a function at 60s on Hobby (300s on Pro). Shift data is cached
// on the roster so a pull makes a handful of ZenHR calls, not one per employee.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 400 }
      );
    }
    const results = await applyRows(parsed.data.rows, user.name);
    const failed = results.filter((r) => !r.ok).length;
    return NextResponse.json({ results, applied: results.length - failed, failed });
  } catch (err) {
    if (err instanceof UnauthorisedError) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
