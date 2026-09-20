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
  // Days of each type ZenHR has approved for this employee this calendar
  // year - real data, nothing for anyone to keep up to date.
  emergency: { usedThisYear: number };
  annual: { usedThisYear: number };
  // The remaining balance as ZenHR holds it, when ZenHR gives it to us.
  // ZenHR's documented API v3 exposes no per-leave-type balance endpoint
  // (`timeoff_balance` exists only as a single figure on salary records), so
  // this stays null until they confirm an endpoint for it. The review pane
  // shows "from ZenHR" rather than a number this tool invented.
  remaining: { emergency: number | null; annual: number | null } | null;
}

// Shared with the engine: a deny-list, so an unfamiliar status never
// silently turns booked leave into an absence.
import { statusCoversDay } from "./reconcile";

// ZenHR returns dates either with an explicit offset ("2026-09-08T00:00:00+03:00",
// where the written date is the local one) or in UTC ("2026-09-08T21:00:00Z",
// which is already the next day in Cairo). Slicing the string handles the
// first and gets the second wrong by a day, so UTC timestamps are converted
// to the branch's timezone first.
const BRANCH_TIMEZONE = process.env.ZENHR_TIMEZONE || "Africa/Cairo";

// ZenHR records an hourly permission as a transaction whose times span part
// of a day (16:00-20:00), and a whole day as midnight to midnight. The
// distinction matters: a half-day permission must not hide the rest of the
// day from review.
export function zenhrTime(iso: string): string | null {
  if (!iso) return null;
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

export function isPartialDay(fromIso: string, toIso: string): boolean {
  const start = zenhrTime(fromIso);
  const end = zenhrTime(toIso);
  if (!start || !end) return false;
  if (zenhrDate(fromIso) !== zenhrDate(toIso)) return false;
  // Midnight to midnight is how a full day is written.
  if (start === "00:00" && end === "00:00") return false;
  return start !== end;
}

export function zenhrDate(iso: string): DateStr {
  if (!iso) return iso;
  const hasExplicitOffset = /[+-]\d{2}:?\d{2}$/.test(iso);
  if (hasExplicitOffset) return iso.slice(0, 10);
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: BRANCH_TIMEZONE }).format(parsed);
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
export interface ShiftInfo {
  label: string;
  // Weekday numbers the shift has off, e.g. [5, 6] for Friday + Saturday.
  daysOff: number[];
}

// How long a cached shift is trusted before being re-read from ZenHR.
const SHIFT_CACHE_MS = 24 * 60 * 60 * 1000;

// Each employee's shift assignment, cached on their roster row.
//
// Shifts live on their own per-employee endpoint, so reading them fresh
// costs one call per person - enough to push a pull past a serverless
// function's time limit. They change rarely, so they are re-read only when
// the cache is a day old (or `force` is set), and every other pull reads
// them straight out of the database.
async function shiftInfo(
  branchId: number,
  employees: {
    employmentNumber: string;
    zenhrEmployeeId: number | null;
    shiftLabel: string | null;
    shiftDaysOff: number[];
    shiftSyncedAt: Date | null;
  }[],
  warnings: string[],
  force = false
): Promise<Map<string, ShiftInfo>> {
  const out = new Map<string, ShiftInfo>();
  const stale: typeof employees = [];

  for (const emp of employees) {
    const fresh =
      !force &&
      emp.shiftSyncedAt !== null &&
      Date.now() - emp.shiftSyncedAt.getTime() < SHIFT_CACHE_MS;
    if (fresh) {
      // A cached row with no shift means ZenHR had none to give; keep that
      // answer rather than asking again on every pull.
      if (emp.shiftLabel) {
        out.set(emp.employmentNumber, { label: emp.shiftLabel, daysOff: emp.shiftDaysOff });
      }
      continue;
    }
    if (emp.zenhrEmployeeId) stale.push(emp);
  }

  if (!stale.length) return out;

  let workShifts: zenhr.ZenhrWorkShift[] = [];
  try {
    workShifts = await zenhr.listWorkShifts(branchId);
  } catch (err) {
    warnings.push(`Could not read work shifts from ZenHR: ${(err as Error).message}`);
    return out;
  }
  const shiftById = new Map(workShifts.map((s) => [s.id, s]));

  for (const emp of stale) {
    try {
      const assignments = await zenhr.listEmployeeShifts(branchId, emp.zenhrEmployeeId as number);
      const latest = assignments.sort((a, b) => b.from_date.localeCompare(a.from_date))[0];
      const shift = latest ? shiftById.get(latest.work_shift.id) : undefined;

      // Responses carry the singular `work_shift_interval`; fall back to the
      // shift's own from/to when it has no intervals.
      const interval = shift?.work_shift_interval?.[0];
      const from = interval?.from_time ?? shift?.from_time;
      const to = interval?.to_time ?? shift?.to_time;
      const info = shift
        ? {
            label: from && to ? `${from} - ${to}` : shift.name,
            daysOff: zenhr.weekdayNumbers(shift.days_off),
          }
        : null;

      if (info) out.set(emp.employmentNumber, info);
      await prisma.rosterEmployee.update({
        where: { employmentNumber: emp.employmentNumber },
        data: {
          shiftLabel: info?.label ?? null,
          shiftDaysOff: info?.daysOff ?? [],
          shiftSyncedAt: new Date(),
        },
      });
    } catch (err) {
      warnings.push(
        `Could not read the shift assignment for ${emp.employmentNumber}: ${(err as Error).message}`
      );
    }
  }
  return out;
}

// What each employee has actually taken of each type this year, straight
// from ZenHR's own approved transactions. Deliberately not entitlement
// minus usage: an entitlement figure kept inside this tool would drift from
// ZenHR and quietly mislead the Emergency/Annual decision.
async function readBalances(
  branchId: number,
  employees: { employmentNumber: string; zenhrEmployeeId: number | null }[],
  year: number,
  warnings: string[]
): Promise<Record<string, BucketBalances>> {
  const maps = await prisma.leaveTypeMap.findMany();
  const emergencyId = maps.find((m) => m.bucket === "EMERGENCY")?.zenhrTimeoffId ?? null;
  const annualId = maps.find((m) => m.bucket === "ANNUAL")?.zenhrTimeoffId ?? null;

  let transactions: zenhr.ZenhrTimeoffTransaction[] = [];
  try {
    transactions = await zenhr.listTimeoffTransactions(branchId, `${year}-01-01`, `${year}-12-31`);
  } catch (err) {
    warnings.push(`Could not read this year's time-off transactions: ${(err as Error).message}`);
  }

  const usedByEmployeeAndType = new Map<string, number>();
  for (const t of transactions) {
    if (!statusCoversDay(t.status)) continue;
    const k = `${t.employee.id}|${t.timeoff.id}`;
    usedByEmployeeAndType.set(k, (usedByEmployeeAndType.get(k) ?? 0) + (t.amount ?? 0));
  }

  const out: Record<string, BucketBalances> = {};
  for (const emp of employees) {
    const used = (timeoffId: number | null) =>
      emp.zenhrEmployeeId && timeoffId
        ? usedByEmployeeAndType.get(`${emp.zenhrEmployeeId}|${timeoffId}`) ?? 0
        : 0;
    out[emp.employmentNumber] = {
      emergency: { usedThisYear: used(emergencyId) },
      annual: { usedThisYear: used(annualId) },
      remaining: null,
    };
  }
  return out;
}

export interface PullOptions {
  from: DateStr;
  to: DateStr;
  // Skip shifts entirely, cache included.
  includeShifts?: boolean;
  // Re-read every employee's shift from ZenHR instead of trusting the
  // day-old cache - for when somebody's shift has just been changed.
  refreshShifts?: boolean;
}

export async function pullAndReconcile(options: PullOptions): Promise<PullResult> {
  const { from, to } = options;
  const warnings: string[] = [];

  const branchId = await resolveBranchId();
  try {
    const branches = await zenhr.listBranches();
    if (branches.length > 1) {
      const others = branches
        .filter((b) => b.id !== branchId)
        .map((b) => `${typeof b.name === "string" ? b.name : b.name?.en} (${b.id})`);
      warnings.push(
        `ZenHR has more than one branch. This pass reads branch ${branchId} only; ` +
          `${others.join(", ")} ${others.length === 1 ? "is" : "are"} not included. ` +
          `Set ZENHR_BRANCH_ID to pin a different one.`
      );
    }
  } catch {
    // Branch listing is informational; never fail a pass over it.
  }
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
  // Leave reaches ZenHR two ways: HR adds it directly (it lands in
  // timeoff_transactions as AddedByHR) or an employee requests it and a
  // manager approves (it lands in timeoff_transaction_requests). Reading only
  // the first makes properly booked leave look like an absence, so both are
  // read and merged on id.
  const [transactionsResult, requestsResult] = await Promise.allSettled([
    zenhr.listTimeoffTransactions(branchId, from, to),
    zenhr.listTimeoffTransactionRequests(branchId, from, to),
  ]);

  if (transactionsResult.status === "rejected") {
    warnings.push(`Could not read time-off transactions: ${transactionsResult.reason}`);
  }
  if (requestsResult.status === "rejected") {
    warnings.push(
      `Could not read time-off requests: ${requestsResult.reason}. Leave that employees requested ` +
        `themselves may be missing from this pass, so check anything flagged as an absence.`
    );
  }

  const byTransactionId = new Map<number, zenhr.ZenhrTimeoffTransaction>();
  for (const t of transactionsResult.status === "fulfilled" ? transactionsResult.value : []) {
    byTransactionId.set(t.id, t);
  }
  let fromRequests = 0;
  for (const t of requestsResult.status === "fulfilled" ? requestsResult.value : []) {
    // The requests endpoint does not narrow by our date filters the way the
    // transactions one does, so the overlap is decided here.
    if (zenhrDate(t.from_date) > to || zenhrDate(t.to_date) < from) continue;
    if (!byTransactionId.has(t.id)) fromRequests += 1;
    byTransactionId.set(t.id, t);
  }
  const timeoffTransactions = [...byTransactionId.values()];
  const timeoff: EngineTimeoff[] = [];
  // Whatever ZenHR returned, reported back plainly. Leave silently missing is
  // the failure that charges someone for a day they booked, so the pull says
  // how many transactions arrived, which statuses they carried, and how many
  // could not be matched to a roster row.
  const statusCounts = new Map<string, number>();
  let unmatchedTransactions = 0;
  for (const t of timeoffTransactions) {
    const label = `${t.status || "unspecified"}${statusCoversDay(t.status) ? "" : " (ignored)"}`;
    statusCounts.set(label, (statusCounts.get(label) ?? 0) + 1);
    const employmentNumber = byZenhrId.get(t.employee.id)?.employmentNumber;
    if (!employmentNumber) {
      unmatchedTransactions += 1;
      continue;
    }
    timeoff.push({
      employmentNumber,
      from: zenhrDate(t.from_date),
      to: zenhrDate(t.to_date),
      fromTime: zenhrTime(t.from_date),
      toTime: zenhrTime(t.to_date),
      amount: t.amount ?? null,
      partialDay: isPartialDay(t.from_date, t.to_date),
      timeoffId: t.timeoff.id,
      timeoffName: timeoffNameById.get(t.timeoff.id) ?? `Time off #${t.timeoff.id}`,
      status: t.status,
      notes: t.notes ?? "",
    });
  }

  if (timeoffTransactions.length === 0) {
    warnings.push(
      `ZenHR returned no time-off transactions at all for ${from} to ${to}. If people did book ` +
        `leave in that range, the reads are not seeing it - check the app's Data Access Level is ` +
        `Company rather than User.`
    );
  } else {
    warnings.push(
      `Time off: ${timeoffTransactions.length} records from ZenHR` +
        (fromRequests ? ` (${fromRequests} of them employee requests)` : "") +
        ` - ${[...statusCounts].map(([status, count]) => `${count} ${status}`).join(", ")}.` +
        (unmatchedTransactions
          ? ` ${unmatchedTransactions} belong to employees not on the roster and were skipped.`
          : "")
    );
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
  const shifts =
    options.includeShifts === false
      ? new Map<string, ShiftInfo>()
      : await shiftInfo(branchId, roster, warnings, options.refreshShifts === true);
  const balances = await readBalances(branchId, roster, Number(to.slice(0, 4)), warnings);

  // Which leave types count as a business mission, so a day covered by one
  // reads as worked rather than as leave.
  const businessMissionTimeoffIds = new Set(
    timeoffTypes.filter((t) => zenhr.isBusinessMission(t)).map((t) => t.id)
  );
  const mappedMission = await prisma.leaveTypeMap.findUnique({
    where: { bucket: "BUSINESS_MISSION" },
  });
  if (mappedMission?.zenhrTimeoffId) businessMissionTimeoffIds.add(mappedMission.zenhrTimeoffId);

  const employees: EngineEmployee[] = roster.map((r) => {
    const shift = shifts.get(r.employmentNumber);
    // Days off come from the employee's ZenHR shift. The roster column is
    // only a fallback for someone with no shift assigned, and the row says
    // which one was used so a wrong day off is traceable.
    const fromShift = (shift?.daysOff.length ?? 0) > 0;
    return {
      employmentNumber: r.employmentNumber,
      nameEn: r.nameEn,
      role: r.role,
      tracking: r.tracking,
      excluded: r.excluded,
      daysOff: fromShift ? (shift as ShiftInfo).daysOff : r.daysOff,
      daysOffFromShift: fromShift,
      zenhrEmployeeId: r.zenhrEmployeeId,
      shiftLabel: shift?.label ?? null,
      hiringDate: null,
      terminationDate: null,
    };
  });

  for (const r of roster) {
    if (r.excluded || !r.zenhrEmployeeId) continue;
    if (!shifts.get(r.employmentNumber)) {
      warnings.push(
        `${r.employmentNumber} ${r.nameEn} has no shift assigned in ZenHR, so their days off fall back to the roster default.`
      );
    }
  }

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
    businessMissionTimeoffIds,
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
