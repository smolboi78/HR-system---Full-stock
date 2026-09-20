import { NextResponse } from "next/server";
import { z } from "zod";
import { employeeBalances } from "@/lib/pull";

// One employee's leave usage, read when a row is opened rather than for the
// whole branch on every pull.
export const maxDuration = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = z
    .object({
      employmentNumber: z.string().min(1),
      year: z.coerce.number().int().min(2000).max(2100),
    })
    .safeParse({
      employmentNumber: url.searchParams.get("employmentNumber"),
      year: url.searchParams.get("year") ?? new Date().getFullYear(),
    });
  if (!parsed.success) {
    return NextResponse.json({ error: "employmentNumber is required" }, { status: 400 });
  }

  try {
    const balances = await employeeBalances(parsed.data.employmentNumber, parsed.data.year);
    return NextResponse.json(balances);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
