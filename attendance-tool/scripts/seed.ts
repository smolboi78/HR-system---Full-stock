// Idempotent seed: the standing roster, the reason list, and the four leave
// buckets. Safe on every boot - existing rows are left alone except for the
// fields this file owns, so in-tool edits survive a redeploy.

import { PrismaClient } from "@prisma/client";
import { ROSTER_SEED } from "../src/lib/roster-seed";
import { REASON_SEED, BUCKET_NAME_HINTS } from "../src/lib/reasons";

const prisma = new PrismaClient();

async function main() {
  let created = 0;
  for (const row of ROSTER_SEED) {
    const existing = await prisma.rosterEmployee.findUnique({
      where: { employmentNumber: row.employmentNumber },
    });
    if (existing) continue;
    await prisma.rosterEmployee.create({
      data: {
        employmentNumber: row.employmentNumber,
        nameEn: row.nameEn,
        role: row.role,
        tracking: row.tracking,
        excluded: row.excluded ?? false,
        bricksAlias: row.bricksAlias ?? null,
      },
    });
    created += 1;
  }
  console.log(`Roster: ${created} added, ${ROSTER_SEED.length - created} already present.`);

  for (const reason of REASON_SEED) {
    await prisma.reason.upsert({
      where: { code: reason.code },
      // Only the code and presentation defaults are seeded; if the row is
      // already there, the team's own edits win.
      create: reason,
      update: {},
    });
  }
  console.log(`Reasons: ${REASON_SEED.length} present.`);

  for (const bucket of Object.keys(BUCKET_NAME_HINTS) as (keyof typeof BUCKET_NAME_HINTS)[]) {
    await prisma.leaveTypeMap.upsert({
      where: { bucket: bucket as never },
      create: {
        bucket: bucket as never,
        // Egypt's statutory emergency entitlement is the usual starting
        // point; both are editable at /settings, and the 6->7 day
        // entitlement bookkeeping is explicitly out of scope here.
        entitlementDays: bucket === "EMERGENCY" ? 7 : bucket === "ANNUAL" ? 21 : 0,
      },
      update: {},
    });
  }
  console.log("Leave buckets present.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
