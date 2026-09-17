import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export async function GET() {
  const roster = await prisma.rosterEmployee.findMany({ orderBy: { employmentNumber: "asc" } });
  return NextResponse.json({ roster });
}

const Upsert = z.object({
  employmentNumber: z.string().trim().min(1).max(20),
  nameEn: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(80),
  tracking: z.enum(["HOURS", "PRESENCE", "DELIVERY"]),
  excluded: z.boolean().optional(),
  daysOff: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  bricksAlias: z.string().trim().max(160).nullish(),
  active: z.boolean().optional(),
});

// Upsert so the same form both edits a standing row and adds a new hire.
export async function PUT(request: Request) {
  const parsed = Upsert.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const { employmentNumber, ...rest } = parsed.data;
  const data = { ...rest, bricksAlias: rest.bricksAlias ?? null };
  const row = await prisma.rosterEmployee.upsert({
    where: { employmentNumber },
    create: { employmentNumber, ...data },
    update: data,
  });
  return NextResponse.json({ row });
}

// Leavers are deactivated, not deleted: their applied deductions stay
// meaningful and the audit trail keeps pointing at a real roster row.
export async function DELETE(request: Request) {
  const employmentNumber = new URL(request.url).searchParams.get("employmentNumber");
  if (!employmentNumber) {
    return NextResponse.json({ error: "employmentNumber is required" }, { status: 400 });
  }
  const row = await prisma.rosterEmployee.update({
    where: { employmentNumber },
    data: { active: false },
  });
  return NextResponse.json({ row });
}
