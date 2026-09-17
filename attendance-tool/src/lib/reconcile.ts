// The resolution engine.
//
// Pure functions over already-fetched data: no I/O, no Prisma, no fetch.
// That keeps the rules testable (see tests/reconcile.test.ts) and keeps the
// ZenHR/Bricks plumbing out of the decision-making.
//
// The rule that does most of the work: a day with no clock-in but an
// approved time-off transaction covering it is NOT an absence. Everything
// the rules can resolve is marked resolved; anything they cannot lands in
// the review queue with the reason left blank rather than guessed.

import { eachDateStr, holidayName, isFuture, weekday, type DateStr } from "./dates";
import { HOURS_PER_LEAVE_DAY } from "./reasons";

export type Tracking = "HOURS" | "PRESENCE" | "DELIVERY";

export interface EngineEmployee {
  employmentNumber: string;
  nameEn: string;
  role: string;
  tracking: Tracking;
  excluded: boolean;
  daysOff: number[];
  zenhrEmployeeId: number | null;
  shiftLabel: string | null; // e.g. "09:00 - 17:00", from the ZenHR shift assignment
  hiringDate: DateStr | null;
  terminationDate: DateStr | null;
}

export interface EngineAttendance {
  employmentNumber: string;
  date: DateStr;
  entryTime: string | null;
  exitTime: string | null;
  missingStatus: string;
  suspicious: boolean;
}

export interface EngineTimeoff {
  employmentNumber: string;
  from: DateStr;
  to: DateStr;
  timeoffId: number;
  timeoffName: string;
  status: string;
  notes: string;
}

export interface EngineVisits {
  employmentNumber: string;
  date: DateStr;
  count: number;
}

export type RowState =
  // Resolved by the rules; nothing for a reviewer to do.
  | "PRESENT"
  | "TIME_OFF"
  | "DAY_OFF"
  | "HOLIDAY"
  | "NOT_EMPLOYED"
  // On the roster, but no ZenHR employee carries that employment number.
  // Raised once per employee rather than once per day: it is a mapping
  // problem to fix at /roster, not a day to charge anybody for.
  | "UNMATCHED"
  // Needs a decision before anything is written to ZenHR.
  | "EXCEPTION";

export interface Flag {
  code: "IRREGULAR_DURATION" | "NO_BRICKS_VISITS" | "MISSING_CHECKOUT" | "SUSPICIOUS" | "NO_ZENHR_ID";
  label: string;
  // Reference flags are shown but never drive a deduction.
  reference: boolean;
}

export interface ResolvedRow {
  employmentNumber: string;
  nameEn: string;
  role: string;
  tracking: Tracking;
  date: DateStr;
  state: RowState;
  // Plain-language account of why the engine landed here.
  detail: string;
  shiftLabel: string | null;

  // Raw signals, surfaced in the review pane.
  zenhrEntry: string | null;
  zenhrExit: string | null;
  workedHours: number | null;
  bricksVisits: number | null;
  timeoffName: string | null;

  flags: Flag[];

  // Pre-filled from the standing rules on an exception, and left null when
  // the rules cannot say - a blank reason is the honest answer.
  suggestedReason: string | null;
}

export interface ReconcileInput {
  from: DateStr;
  to: DateStr;
  employees: EngineEmployee[];
  attendance: EngineAttendance[];
  timeoff: EngineTimeoff[];
  visits: EngineVisits[];
  // Days already pushed to ZenHR, keyed "employmentNumber|date" - these
  // drop out of the queue so a second pass cannot double-charge.
  alreadyApplied?: Set<string>;
  businessMissionEmployee?: string;
  today?: DateStr;
}

// ZenHR marks a transaction's lifecycle in `status`. Only these actually
// cover a day; a cancelled or withdrawn request does not.
const COVERING_TIMEOFF_STATUSES = new Set(["approved", "accepted", "taken", "active"]);

export function coversDay(t: EngineTimeoff, date: DateStr): boolean {
  return t.from <= date && date <= t.to;
}

export function key(employmentNumber: string, date: DateStr): string {
  return `${employmentNumber}|${date}`;
}

function hoursBetween(entry: string | null, exit: string | null): number | null {
  if (!entry || !exit) return null;
  const ms = new Date(exit).getTime() - new Date(entry).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

// An "irregular duration" per the spec: a clocked day of one hour or less.
const IRREGULAR_DURATION_HOURS = 1;

function indexBy<T>(rows: T[], k: (row: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const row of rows) m.set(k(row), row);
  return m;
}

export function reconcile(input: ReconcileInput): ResolvedRow[] {
  const today = input.today;
  const applied = input.alreadyApplied ?? new Set<string>();
  const attendanceByKey = indexBy(input.attendance, (a) => key(a.employmentNumber, a.date));
  const visitsByKey = indexBy(input.visits, (v) => key(v.employmentNumber, v.date));

  const timeoffByEmployee = new Map<string, EngineTimeoff[]>();
  for (const t of input.timeoff) {
    const list = timeoffByEmployee.get(t.employmentNumber) ?? [];
    list.push(t);
    timeoffByEmployee.set(t.employmentNumber, list);
  }

  const dates = eachDateStr(input.from, input.to);
  const rows: ResolvedRow[] = [];

  for (const emp of input.employees) {
    // Excluded employees (Managing Director, HR Consultant, Co-Founder)
    // are off all attendance rules entirely - no rows at all.
    if (emp.excluded) continue;

    if (!emp.zenhrEmployeeId) {
      rows.push({
        employmentNumber: emp.employmentNumber,
        nameEn: emp.nameEn,
        role: emp.role,
        tracking: emp.tracking,
        date: input.from,
        state: "UNMATCHED",
        detail:
          "On the roster but no ZenHR employee carries this employment number, so none of their days could be checked",
        shiftLabel: emp.shiftLabel,
        zenhrEntry: null,
        zenhrExit: null,
        workedHours: null,
        bricksVisits: null,
        timeoffName: null,
        flags: [
          { code: "NO_ZENHR_ID", label: "Not matched to a ZenHR employee", reference: false },
        ],
        suggestedReason: null,
      });
      continue;
    }

    for (const date of dates) {
      if (today && isFuture(date, today)) continue;
      if (applied.has(key(emp.employmentNumber, date))) continue;

      const att = attendanceByKey.get(key(emp.employmentNumber, date));
      const visits = visitsByKey.get(key(emp.employmentNumber, date))?.count ?? null;
      const flags: Flag[] = [];

      const base = {
        employmentNumber: emp.employmentNumber,
        nameEn: emp.nameEn,
        role: emp.role,
        tracking: emp.tracking,
        date,
        shiftLabel: emp.shiftLabel,
        zenhrEntry: att?.entryTime ?? null,
        zenhrExit: att?.exitTime ?? null,
        workedHours: hoursBetween(att?.entryTime ?? null, att?.exitTime ?? null),
        bricksVisits: emp.tracking === "HOURS" ? null : visits,
        timeoffName: null as string | null,
        flags,
        suggestedReason: null as string | null,
      };

      // Not on the payroll that day - never an absence.
      if (
        (emp.hiringDate && date < emp.hiringDate) ||
        (emp.terminationDate && date > emp.terminationDate)
      ) {
        rows.push({
          ...base,
          state: "NOT_EMPLOYED",
          detail: emp.hiringDate && date < emp.hiringDate ? "Before hiring date" : "After termination date",
        });
        continue;
      }

      // An approved time-off transaction covering the day settles it,
      // whether or not anybody clocked in.
      const covering = (timeoffByEmployee.get(emp.employmentNumber) ?? []).find(
        (t) => coversDay(t, date) && COVERING_TIMEOFF_STATUSES.has(t.status.toLowerCase())
      );
      if (covering) {
        rows.push({
          ...base,
          state: "TIME_OFF",
          timeoffName: covering.timeoffName,
          detail: `Covered by an approved ${covering.timeoffName} transaction in ZenHR`,
        });
        continue;
      }

      // Weekly day off and public holidays: no attendance expected. A
      // clock-in on such a day is left as a resolved row, not an exception.
      const holiday = holidayName(date);
      if (holiday) {
        rows.push({ ...base, state: "HOLIDAY", detail: holiday });
        continue;
      }
      if (emp.daysOff.includes(weekday(date))) {
        rows.push({ ...base, state: "DAY_OFF", detail: "Weekly day off" });
        continue;
      }

      if (att) {
        if (att.suspicious) {
          flags.push({ code: "SUSPICIOUS", label: "ZenHR flagged this record suspicious", reference: true });
        }
        if (visits === 0 && emp.tracking === "DELIVERY") {
          // Reference only: red on the dashboard, never an auto-deduction.
          flags.push({ code: "NO_BRICKS_VISITS", label: "No Bricks visits", reference: true });
        }

        const missingCheckout = !att.exitTime || att.missingStatus === "missing_out";
        if (missingCheckout) {
          flags.push({ code: "MISSING_CHECKOUT", label: "No checkout recorded", reference: false });
          rows.push({
            ...base,
            state: "EXCEPTION",
            detail: "Clocked in but never clocked out",
            suggestedReason: "MISSING_CHECKOUT",
          });
          continue;
        }

        // Duration only matters where hours are the measure; for
        // presence-only and delivery roles a short day is still a day.
        if (
          base.workedHours !== null &&
          base.workedHours <= IRREGULAR_DURATION_HOURS &&
          emp.tracking !== "PRESENCE"
        ) {
          flags.push({
            code: "IRREGULAR_DURATION",
            label: `Only ${base.workedHours}h clocked`,
            reference: false,
          });
          rows.push({
            ...base,
            state: "EXCEPTION",
            detail: `Irregular duration: ${base.workedHours}h clocked (≤${IRREGULAR_DURATION_HOURS}h)`,
            // Deliberately blank: a one-hour day could be a personal
            // excuse, a mission, or a system issue. The rules can't say.
            suggestedReason: null,
          });
          continue;
        }

        rows.push({
          ...base,
          state: "PRESENT",
          detail:
            base.workedHours !== null
              ? `Present, ${base.workedHours}h clocked`
              : "Present in ZenHR",
        });
        continue;
      }

      // No ZenHR record. For presence-only and delivery roles a Bricks
      // visit is enough to count the day as worked.
      if (emp.tracking !== "HOURS" && visits && visits > 0) {
        rows.push({
          ...base,
          state: "PRESENT",
          detail: `No ZenHR record, but ${visits} Bricks visit${visits === 1 ? "" : "s"} that day`,
        });
        continue;
      }

      if (visits === 0 && emp.tracking === "DELIVERY") {
        flags.push({ code: "NO_BRICKS_VISITS", label: "No Bricks visits", reference: true });
      }

      // A genuine unexplained gap: no attendance record and no time-off
      // transaction. Employee 211 files a Business Mission whenever he is
      // out, so his gaps point at a mission to confirm rather than a
      // straight absence.
      const isMissionFiler = input.businessMissionEmployee === emp.employmentNumber;
      rows.push({
        ...base,
        state: "EXCEPTION",
        detail: isMissionFiler
          ? "No ZenHR record and no time-off transaction - expected a Business Mission entry"
          : "No ZenHR record and no time-off transaction",
        suggestedReason: isMissionFiler ? "BUSINESS_MISSION" : "FULL_DAY_ABSENCE",
      });
    }
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.employmentNumber.localeCompare(b.employmentNumber));
  return rows;
}

export interface ReconcileSummary {
  totalRows: number;
  present: number;
  timeOff: number;
  daysOff: number;
  exceptions: number;
  unmatched: number;
  referenceFlags: number;
}

export function summarise(rows: ResolvedRow[]): ReconcileSummary {
  return {
    totalRows: rows.length,
    present: rows.filter((r) => r.state === "PRESENT").length,
    timeOff: rows.filter((r) => r.state === "TIME_OFF").length,
    daysOff: rows.filter((r) => r.state === "DAY_OFF" || r.state === "HOLIDAY").length,
    exceptions: rows.filter((r) => r.state === "EXCEPTION").length,
    unmatched: rows.filter((r) => r.state === "UNMATCHED").length,
    referenceFlags: rows.filter((r) => r.flags.some((f) => f.reference)).length,
  };
}

// Emergency first, falling to annual once the emergency balance is spent -
// the default the review pane pre-selects on the Emergency/Annual toggle.
export function preferredBucket(
  days: number,
  emergencyRemaining: number
): "EMERGENCY" | "ANNUAL" {
  return emergencyRemaining >= days ? "EMERGENCY" : "ANNUAL";
}

export function daysForHours(hours: number): number {
  return Math.round((hours / HOURS_PER_LEAVE_DAY) * 100) / 100;
}
