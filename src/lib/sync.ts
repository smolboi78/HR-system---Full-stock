import { prisma } from "./db";
import {
  listBranches,
  listEmployees,
  listAttendanceRecords,
  extractJobRole,
  type ZenhrEmployee,
  type ZenhrAttendanceRecord,
  type AttendanceDateRange,
} from "./zenhr";
import { listVisits, type BricksVisit } from "./bricks";

function displayName(emp: ZenhrEmployee): { first: string; last: string; display: string } {
  const en = emp.user?.name?.en;
  const first = en?.first_name?.trim() || "";
  const last = en?.last_name?.trim() || "";
  const display = [first, last].filter(Boolean).join(" ") || `Employee ${emp.employment_number}`;
  return { first, last, display };
}

async function runSync<T>(
  source: "ZENHR" | "BRICKS",
  fn: () => Promise<number>
): Promise<void> {
  const run = await prisma.syncRun.create({ data: { source, status: "RUNNING" } });
  try {
    const count = await fn();
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "SUCCESS", finishedAt: new Date(), recordsSynced: count },
    });
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

export async function syncBranches(): Promise<void> {
  await runSync("ZENHR", async () => {
    const branches = await listBranches();
    for (const branch of branches) {
      await prisma.branch.upsert({
        where: { id: branch.id },
        create: {
          id: branch.id,
          nameEn: branch.name.en,
          timezone: branch.timezone,
          workingHours: branch.working_hours,
          daysOff: branch.days_off.map((d) => parseInt(d, 10)),
        },
        update: {
          nameEn: branch.name.en,
          timezone: branch.timezone,
          workingHours: branch.working_hours,
          daysOff: branch.days_off.map((d) => parseInt(d, 10)),
        },
      });
    }
    return branches.length;
  });
}

export async function syncEmployees(): Promise<void> {
  await runSync("ZENHR", async () => {
    const branches = await listBranches();
    const overrides = await prisma.employeeNameOverride.findMany();
    const overrideByEmploymentNumber = new Map(
      overrides.map((o) => [o.employmentNumber, o.bricksDisplayName])
    );
    const categoryRules = await prisma.jobRoleCategoryRule.findMany();
    const categoryByJobRole = new Map(categoryRules.map((r) => [r.jobRole, r.category]));

    let count = 0;
    for (const branch of branches) {
      const employees = await listEmployees(branch.id);
      for (const emp of employees) {
        const { first, last, display } = displayName(emp);
        const bricksDisplayName = overrideByEmploymentNumber.get(String(emp.employment_number));
        const jobRole = extractJobRole(emp);
        const category = (jobRole && categoryByJobRole.get(jobRole)) || "OTHER";

        await prisma.employee.upsert({
          where: { zenhrEmployeeId: emp.id },
          create: {
            zenhrEmployeeId: emp.id,
            zenhrBranchId: emp.branch_id,
            employmentNumber: String(emp.employment_number),
            firstNameEn: first,
            lastNameEn: last,
            displayNameEn: display,
            active: emp.active,
            hiringDate: emp.hiring_date ? new Date(emp.hiring_date) : null,
            terminationDate: emp.termination_date ? new Date(emp.termination_date) : null,
            bricksDisplayName: bricksDisplayName ?? display,
            jobRole,
            category,
          },
          update: {
            zenhrBranchId: emp.branch_id,
            employmentNumber: String(emp.employment_number),
            firstNameEn: first,
            lastNameEn: last,
            displayNameEn: display,
            active: emp.active,
            hiringDate: emp.hiring_date ? new Date(emp.hiring_date) : null,
            terminationDate: emp.termination_date ? new Date(emp.termination_date) : null,
            // Don't stomp a manually-fixed bricksDisplayName with the
            // auto-derived one on every sync unless it was never set.
            ...(bricksDisplayName ? { bricksDisplayName } : {}),
            jobRole,
            category,
          },
        });
        count += 1;
      }
    }
    return count;
  });
}

function computeWorkedMinutes(entry: string | null, exit: string | null): number | null {
  if (!entry || !exit) return null;
  const ms = new Date(exit).getTime() - new Date(entry).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 60000);
}

export async function syncAttendance(range: AttendanceDateRange): Promise<void> {
  await runSync("ZENHR", async () => {
    const branches = await listBranches();
    let count = 0;

    for (const branch of branches) {
      const records = await listAttendanceRecords(branch.id, range);
      for (const rec of records) {
        const employee = await prisma.employee.findUnique({
          where: { zenhrEmployeeId: rec.employee.id },
        });
        if (!employee) {
          // Attendance record for an employee we haven't synced yet -
          // run syncEmployees first. Skip rather than fail the whole batch.
          continue;
        }

        await upsertAttendanceRecord(employee.id, rec);
        count += 1;
      }
    }
    return count;
  });
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface VisitDateRange {
  from: string; // ISO date-time
  to: string; // ISO date-time
}

// Matches Bricks visits to ZenHR employees and stores them. Employees with
// no ZenHR<->Bricks link (Delivery Agents, Management) simply won't match
// any visit - that's expected, only Sales/Collectors show up in Bricks.
export async function syncVisits(range: VisitDateRange): Promise<void> {
  await runSync("BRICKS", async () => {
    const employees = await prisma.employee.findMany();
    const byBricksUserId = new Map(
      employees.filter((e) => e.bricksUserId).map((e) => [e.bricksUserId as string, e])
    );
    const byNormalizedName = new Map(
      employees.map((e) => [normalizeName(e.bricksDisplayName || e.displayNameEn), e])
    );

    let count = 0;
    let offset = 0;
    const limit = 200;
    while (true) {
      const { visits } = await listVisits(
        { created_from: range.from, created_to: range.to, include_planned: false },
        { limit, offset }
      );
      for (const visit of visits) {
        await upsertVisit(visit, byBricksUserId, byNormalizedName);
        count += 1;
      }
      if (visits.length < limit) break;
      offset += limit;
    }
    return count;
  });
}

async function upsertVisit(
  visit: BricksVisit,
  byBricksUserId: Map<string, { id: string; bricksUserId?: string | null }>,
  byNormalizedName: Map<string, { id: string; bricksUserId?: string | null }>
) {
  const employee =
    byBricksUserId.get(visit.owner_id) ?? byNormalizedName.get(normalizeName(visit.owner.name));

  // First time we see this owner_id via a name match, pin it on the
  // employee so future syncs match by stable id instead of a name that
  // could change or collide.
  if (employee && !employee.bricksUserId) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: { bricksUserId: visit.owner_id },
    });
    employee.bricksUserId = visit.owner_id;
  }

  await prisma.visit.upsert({
    where: { bricksVisitId: visit.id },
    create: {
      bricksVisitId: visit.id,
      employeeId: employee?.id,
      ownerBricksId: visit.owner_id,
      ownerNameRaw: visit.owner.name,
      contactId: visit.contact_id,
      contactName: visit.contact?.name,
      isSuccessful: visit.is_successful ?? null,
      isPlanned: visit.is_planned,
      status: visit.status,
      visitTime: new Date(visit.visit_time),
      durationMs: visit.duration ?? null,
    },
    update: {
      employeeId: employee?.id,
      ownerBricksId: visit.owner_id,
      ownerNameRaw: visit.owner.name,
      contactId: visit.contact_id,
      contactName: visit.contact?.name,
      isSuccessful: visit.is_successful ?? null,
      isPlanned: visit.is_planned,
      status: visit.status,
      visitTime: new Date(visit.visit_time),
      durationMs: visit.duration ?? null,
    },
  });
}

async function upsertAttendanceRecord(employeeId: string, rec: ZenhrAttendanceRecord) {
  const workedMinutes = computeWorkedMinutes(rec.entry_time, rec.exit_time);
  await prisma.attendanceRecord.upsert({
    where: { zenhrRecordId: rec.id },
    create: {
      zenhrRecordId: rec.id,
      employeeId,
      attendanceDate: new Date(rec.attendance_date),
      entryTime: rec.entry_time ? new Date(rec.entry_time) : null,
      exitTime: rec.exit_time ? new Date(rec.exit_time) : null,
      missingStatus: rec.missing_status,
      numberOfMissings: rec.number_of_missings,
      suspicious: rec.suspicious,
      workedMinutes,
      sourceUpdatedAt: new Date(rec.updated_at),
    },
    update: {
      attendanceDate: new Date(rec.attendance_date),
      entryTime: rec.entry_time ? new Date(rec.entry_time) : null,
      exitTime: rec.exit_time ? new Date(rec.exit_time) : null,
      missingStatus: rec.missing_status,
      numberOfMissings: rec.number_of_missings,
      suspicious: rec.suspicious,
      workedMinutes,
      sourceUpdatedAt: new Date(rec.updated_at),
    },
  });
}
