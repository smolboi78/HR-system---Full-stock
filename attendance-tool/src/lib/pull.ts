// Pulls everything a reconcile pass needs from ZenHR and Bricks and shapes
// it into the engine's inputs. This is the only place the two APIs and the
// roster are stitched together.

import { prisma } from "./db";
import { toDateStr, type DateStr } from "./dates";
import * as zenhr from "./zenhr";
import * as bricks from "./bricks";
import {
  reconcile,
  summarise,
  type EngineAttendance,
  type EngineEmployee,
  type EngineTimeoff,
  type EngineVisits,
  type ResolvedRow,
} from "./reconcile";
import { BUSINESS_MISSION_EMPLOYEE } from "./roster-seed";

export interface PullResult {
  from: DateStr;
  to: DateStr;
  rows: ResolvedRow[];
  summary: ReturnType<typeof summarise>;
  // Non-fatal problems worth showing rather than swallowing: Bricks down,
  // an unmatched roster entry, a shift we couldn't read.
  warnings: string[];
  balances: Record<string, BucketBalances>;
}

export interface BucketBalances {
  emergency: { entitlement: number; taken: number; remaining: number };
  annual: { entitlement: number; taken: number; remaining: number };
  total: number;
}

function normaliseName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// ZenHR's branch id. A single-branch company, so we take the first branch
// unless one is pinned by env.
export async function resolveBranchId(): Promise<number> {
  const pinned = process.env.ZENHR_BRANCH_ID;
  if (pinned) return Number(pinned);
  const branches = await zenhr.listBranches();
  if (!branches.length) throw new Error("ZenHR returned no branches for this account");
  return branches[0].id;
}

// Matches ZenHR employees onto the standing roster by employment number,
// storing the numeric ZenHR id the per-employee reads and the write
// endpoint need. Also the point where somebody missing from ZenHR entirely
// stays visible rather than silently dropping out.
export async function syncRosterWithZenhr(branchId: number): Promise<string[]> {
  const warnings: string[] = [];
  const employees = await zenhr.listEmployees(branchId);
  const byNumber = new Map(employees.map((e) => [String(e.employment_number).trim(), e]));

  const roster = await prisma.rosterEmployee.findMany();
  for (const row of roster) {
    const match = byNumber.get(row.employmentNumber);
    // No warning for an unmatched roster row: the engine raises it as its
    // own UNMATCHED row, which the review page gives a panel of its own.
    // Repeating it here only buried the rest of the warnings.
    if (!match) continue;
    if (row.zenhrEmployeeId !== match.id || row.zenhrBranchId !== branchId) {
      await prisma.rosterEmployee.update({
        where: { employmentNumber: row.employmentNumber },
        data: { zenhrEmployeeId: match.id, zenhrBranchId: branchId },
      });
    }
  }

  const rosterNumbers = new Set(roster.map((r) => r.employmentNumber));
  for (const e of employees) {
    const num = String(e.employment_number).trim();
    if (e.active && num && !rosterNumbers.has(num)) {
      warnings.push(
        `ZenHR has an active employee not on the roster: ${num} ${zenhr.employeeNameEn(e)}. Add them at /roster.`
      );
    }
  }
  return warnings;
}

// Resolves each employee's current shift assignment into a label for the
// review pane ("09:00 - 17:00"). Shifts live on their own endpoints, not on
// the attendance report, so this is a separate per-employee read - kept to
// employees in the pass and cached for the request only.
async function shiftLabels(
  branchId: number,
  employees: { employmentNumber: string; zenhrEmployeeId: number | null }[],
  warnings: string[]
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  let workShifts: zenhr.ZenhrWorkShift[] = [];
  try {
    workShifts = await zenhr.listWorkShifts(branchId);
  } catch (err) {
    warnings.push(`Could not read work shifts from ZenHR: ${(err as Error).message}`);
    return labels;
  }
  const shiftById = new Map(workShifts.map((s) => [s.id, s]));

  for (const emp of employees) {
    if (!emp.zenhrEmployeeId) continue;
    try {
      const assignments = await zenhr.listEmployeeShifts(branchId, emp.zenhrEmployeeId);
      const latest = assignments.sort((a, b) => b.from_date.localeCompare(a.from_date))[0];
      if (!latest) continue;
      const shift = shiftById.get(latest.work_shift.id);
      if (!shift) continue;
      const interval = shift.work_shift_intervals?.[0];
      const from = interval?.from_time ?? shift.from_time;
      const to = interval?.to_time ?? shift.to_time;
      labels.set(emp.employmentNumber, from && to ? `${from} - ${to}` : shift.name);
    } catch (err) {
      warnings.push(
        `Could not read the shift assignment for ${emp.employmentNumber}: ${(err as Error).message}`
      );
    }
  }
  return labels;
}

// ZenHR exposes no leave-balance endpoint, so a balance is derived:
// entitlement (editable at /settings) minus approved transactions of that
// leave type in the calendar year.
async function deriveBalances(
  branchId: number,
  employees: { employmentNumber: string; zenhrEmployeeId: number | null }[],
  year: number,
  warnings: string[]
): Promise<Record<string, BucketBalances>> {
  const maps = await prisma.leaveTypeMap.findMany();
  const emergency = maps.find((m) => m.bucket === "EMERGENCY");
  const annual = maps.find((m) => m.bucket === "ANNUAL");

  const out: Record<string, BucketBalances> = {};
  let transactions: zenhr.ZenhrTimeoffTransaction[] = [];
  try {
    transactions = await zenhr.listTimeoffTransactions(
      branchId,
      `${year}-01-01`,
      `${year}-12-31`
    );
  } catch (err) {
    warnings.push(`Could not read this year's time-off transactions for balances: ${(err as Error).message}`);
  }

  const takenByEmployeeAndType = new Map<string, number>();
  for (const t of transactions) {
    if (!["approved", "accepted", "taken", "active"].includes(t.status.toLowerCase())) continue;
    const k = `${t.employee.id}|${t.timeoff.id}`;
    takenByEmployeeAndType.set(k, (takenByEmployeeAndType.get(k) ?? 0) + (t.amount ?? 0));
  }

  for (const emp of employees) {
    const taken = (timeoffId: number | null | undefined) =>
      emp.zenhrEmployeeId && timeoffId
        ? takenByEmployeeAndType.get(`${emp.zenhrEmployeeId}|${timeoffId}`) ?? 0
        : 0;

    const emergencyTaken = taken(emergency?.zenhrTimeoffId);
    const annualTaken = taken(annual?.zenhrTimeoffId);
    const emergencyEntitlement = emergency?.entitlementDays ?? 0;
    const annualEntitlement = annual?.entitlementDays ?? 0;

    out[emp.employmentNumber] = {
      emergency: {
        entitlement: emergencyEntitlement,
        taken: emergencyTaken,
        remaining: Math.round((emergencyEntitlement - emergencyTaken) * 100) / 100,
      },
      annual: {
        entitlement: annualEntitlement,
        taken: annualTaken,
        remaining: Math.round((annualEntitlement - annualTaken) * 100) / 100,
      },
      total:
        Math.round((emergencyEntitlement - emergencyTaken + annualEntitlement - annualTaken) * 100) /
        100,
    };
  }
  return out;
}

export interface PullOptions {
  from: DateStr;
  to: DateStr;
  // Skip the per-employee shift reads, which are the slow part of a pass.
  includeShifts?: boolean;
}

export async function pullAndReconcile(options: PullOptions): Promise<PullResult> {
  const { from, to } = options;
  const warnings: string[] = [];

  const branchId = await resolveBranchId();
  warnings.push(...(await syncRosterWithZenhr(branchId)));

  const roster = await prisma.rosterEmployee.findMany({
    where: { active: true },
    orderBy: { employmentNumber: "asc" },
  });

  const byZenhrId = new Map(
    roster.filter((r) => r.zenhrEmployeeId).map((r) => [r.zenhrEmployeeId as number, r])
  );
  const byEmploymentNumber = new Map(roster.map((r) => [r.employmentNumber, r]));

  // --- ZenHR attendance ---
  const attendanceRecords = await zenhr.listAttendanceRecords(branchId, from, to);
  const attendance: EngineAttendance[] = [];
  for (const rec of attendanceRecords) {
    const employmentNumber =
      byZenhrId.get(rec.employee.id)?.employmentNumber ??
      (rec.employee.employment_number != null
        ? String(rec.employee.employment_number).trim()
        : undefined);
    if (!employmentNumber || !byEmploymentNumber.has(employmentNumber)) continue;
    attendance.push({
      employmentNumber,
      date: rec.attendance_date,
      entryTime: rec.entry_time ?? rec.first_in ?? null,
      exitTime: rec.exit_time ?? rec.last_out ?? null,
      missingStatus: rec.missing_status,
      suspicious: rec.suspicious,
    });
  }

  // --- ZenHR time off (what makes a no-clock-in day not an absence) ---
  const timeoffTypes = await zenhr.listTimeoffs(branchId);
  const timeoffNameById = new Map(
    timeoffTypes.map((t) => [t.id, t.name?.en || t.name?.ar || `Time off #${t.id}`])
  );
  const timeoffTransactions = await zenhr.listTimeoffTransactions(branchId, from, to);
  const timeoff: EngineTimeoff[] = [];
  for (const t of timeoffTransactions) {
    const employmentNumber = byZenhrId.get(t.employee.id)?.employmentNumber;
    if (!employmentNumber) continue;
    timeoff.push({
      employmentNumber,
      from: t.from_date.slice(0, 10),
      to: t.to_date.slice(0, 10),
      timeoffId: t.timeoff.id,
      timeoffName: timeoffNameById.get(t.timeoff.id) ?? `Time off #${t.timeoff.id}`,
      status: t.status,
      notes: t.notes ?? "",
    });
  }

  // --- Bricks visits (reference signal; never blocks a pass) ---
  const visits: EngineVisits[] = [];
  if (bricks.isBricksConfigured()) {
    try {
      const raw = await bricks.listVisits(`${from}T00:00:00Z`, `${to}T23:59:59Z`);
      // Bricks names are matched through the fixed alias table only - no
      // fuzzy matching, by design.
      const byAlias = new Map<string, string>();
      for (const r of roster) {
        if (r.bricksAlias) byAlias.set(normaliseName(r.bricksAlias), r.employmentNumber);
        if (r.bricksOwnerId) byAlias.set(`id:${r.bricksOwnerId}`, r.employmentNumber);
      }
      const counts = new Map<string, number>();
      const unmatched = new Set<string>();
      for (const v of raw) {
        const employmentNumber =
          byAlias.get(`id:${v.owner_id}`) ?? byAlias.get(normaliseName(v.owner?.name ?? ""));
        if (!employmentNumber) {
          if (v.owner?.name) unmatched.add(v.owner.name);
          continue;
        }
        const date = toDateStr(new Date(v.visit_time));
        const k = `${employmentNumber}|${date}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      for (const [k, count] of counts) {
        const [employmentNumber, date] = k.split("|");
        visits.push({ employmentNumber, date, count });
      }
      // Zero-fill so "no visits today" is distinguishable from "no Bricks
      // data at all" - the flag depends on that difference.
      for (const r of roster) {
        if (r.tracking === "HOURS") continue;
        for (const date of eachDay(from, to)) {
          if (!counts.has(`${r.employmentNumber}|${date}`)) {
            visits.push({ employmentNumber: r.employmentNumber, date, count: 0 });
          }
        }
      }
      for (const name of unmatched) {
        warnings.push(`Bricks logged visits under "${name}", which matches no alias on the roster.`);
      }
    } catch (err) {
      warnings.push(`Bricks visit data is unavailable: ${(err as Error).message}`);
    }
  } else {
    warnings.push("BRICKS_API_KEY is not set, so delivery-agent visit counts are missing.");
  }

  // --- Shifts and balances ---
  const shifts = options.includeShifts === false
    ? new Map<string, string>()
    : await shiftLabels(branchId, roster, warnings);
  const balances = await deriveBalances(branchId, roster, Number(to.slice(0, 4)), warnings);

  const employees: EngineEmployee[] = roster.map((r) => ({
    employmentNumber: r.employmentNumber,
    nameEn: r.nameEn,
    role: r.role,
    tracking: r.tracking,
    excluded: r.excluded,
    daysOff: r.daysOff,
    zenhrEmployeeId: r.zenhrEmployeeId,
    shiftLabel: shifts.get(r.employmentNumber) ?? null,
    hiringDate: null,
    terminationDate: null,
  }));

  const appliedRows = await prisma.appliedDeduction.findMany({
    where: {
      status: "APPLIED",
      date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
    },
    select: { employmentNumber: true, date: true },
  });
  const alreadyApplied = new Set(
    appliedRows.map((r) => `${r.employmentNumber}|${toDateStr(r.date)}`)
  );

  const rows = reconcile({
    from,
    to,
    employees,
    attendance,
    timeoff,
    visits,
    alreadyApplied,
    businessMissionEmployee: BUSINESS_MISSION_EMPLOYEE,
    today: toDateStr(new Date()),
  });

  return { from, to, rows, summary: summarise(rows), warnings, balances };
}

function eachDay(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    out.push(toDateStr(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
