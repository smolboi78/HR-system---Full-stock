import { Nav } from "../nav";
import { prisma } from "@/lib/db";
import { RosterEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function RosterPage() {
  const roster = await prisma.rosterEmployee.findMany({ orderBy: { employmentNumber: "asc" } });
  return (
    <main className="shell">
      <Nav current="roster" />
      <p className="lede">
        The standing roster. It lives in the tool rather than being re-uploaded each run, which is
        what lets a pull notice somebody missing from ZenHR entirely.
      </p>
      <RosterEditor
        initial={roster.map((r) => ({
          employmentNumber: r.employmentNumber,
          nameEn: r.nameEn,
          role: r.role,
          tracking: r.tracking,
          excluded: r.excluded,
          daysOff: r.daysOff,
          bricksAlias: r.bricksAlias,
          zenhrEmployeeId: r.zenhrEmployeeId,
          active: r.active,
        }))}
      />
    </main>
  );
}
