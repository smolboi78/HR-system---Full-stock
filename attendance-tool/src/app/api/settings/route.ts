import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { BUCKET_NAME_HINTS } from "@/lib/reasons";
import { resolveBranchId } from "@/lib/pull";
import { listTimeoffs } from "@/lib/zenhr";

// Everything the settings page needs: the leave-type mapping, the standing
// reason list, and (when ZenHR is reachable) the branch's real leave types
// to pick from.
export async function GET() {
  const [leaveTypes, reasons] = await Promise.all([
    prisma.leaveTypeMap.findMany(),
    prisma.reason.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  let zenhrTimeoffs: { id: number; name: string }[] = [];
  let warning: string | null = null;
  try {
    const branchId = await resolveBranchId();
    zenhrTimeoffs = (await listTimeoffs(branchId)).map((t) => ({
      id: t.id,
      name: t.name?.en || t.name?.ar || `Time off #${t.id}`,
    }));
  } catch (err) {
    warning = `Could not read ZenHR leave types: ${(err as Error).message}`;
  }

  return NextResponse.json({ leaveTypes, reasons, zenhrTimeoffs, hints: BUCKET_NAME_HINTS, warning });
}

const Body = z.object({
  leaveTypes: z
    .array(
      z.object({
        bucket: z.enum(["EMERGENCY", "ANNUAL", "UNPAID", "BUSINESS_MISSION", "NONE"]),
        zenhrTimeoffId: z.number().int().nullish(),
        zenhrName: z.string().max(160).nullish(),
      })
    )
    .optional(),
  reasons: z
    .array(
      z.object({
        code: z.string().min(1),
        label: z.string().min(1).max(80).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex colour like #d4574a")
          .optional(),
        defaultBucket: z.enum(["EMERGENCY", "ANNUAL", "UNPAID", "BUSINESS_MISSION", "NONE"]).optional(),
        allowsToggle: z.boolean().optional(),
        defaultDays: z.number().min(0).max(30).optional(),
        hoursEditable: z.boolean().optional(),
        active: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .optional(),
});

export async function PUT(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  for (const lt of parsed.data.leaveTypes ?? []) {
    const { bucket, ...rest } = lt;
    const data = {
      zenhrTimeoffId: rest.zenhrTimeoffId ?? null,
      zenhrName: rest.zenhrName ?? null,
    };
    await prisma.leaveTypeMap.upsert({
      where: { bucket },
      create: { bucket, ...data },
      update: data,
    });
  }

  for (const reason of parsed.data.reasons ?? []) {
    const { code, ...data } = reason;
    await prisma.reason.update({ where: { code }, data });
  }

  return NextResponse.json({ ok: true });
}
