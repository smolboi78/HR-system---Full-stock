import { NextResponse } from "next/server";
import { z } from "zod";
import { pullAndReconcile } from "@/lib/pull";
import { prisma } from "@/lib/db";

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// A pass fans out a good number of ZenHR calls (attendance, time off, leave
// types, shifts per employee), so give it room.
// Vercel caps a function at 60s on Hobby (300s on Pro). Shift data is cached
// on the roster so a pull makes a handful of ZenHR calls, not one per employee.
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = z
    .object({
      from: DateStr,
      to: DateStr,
      shifts: z.enum(["0", "1"]).optional(),
      refreshShifts: z.enum(["0", "1"]).optional(),
    })
    .safeParse({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      shifts: url.searchParams.get("shifts") ?? undefined,
      refreshShifts: url.searchParams.get("refreshShifts") ?? undefined,
    });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const { from, to } = parsed.data;
  if (from > to) {
    return NextResponse.json({ error: "The start date is after the end date" }, { status: 400 });
  }

  try {
    const [result, reasons] = await Promise.all([
      pullAndReconcile({
        from,
        to,
        includeShifts: parsed.data.shifts !== "0",
        refreshShifts: parsed.data.refreshShifts === "1",
      }),
      prisma.reason.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    ]);
    return NextResponse.json({ ...result, reasons });
  } catch (err) {
    // Surface which step failed rather than a blank 500 - the usual causes
    // are an unconnected ZenHR app or a missing API key.
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
