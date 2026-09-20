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
  // Weekday numbers off, taken from the employee's assigned ZenHR work
  // shift. daysOffFromShift says whether that is what happened, or whether
  // no shift was assigned and this fell back to the roster's default.
  daysOffFromShift: boolean;
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
  // Times as ZenHR recorded them, when the leave covers only part of a day
  // (an hourly permission such as 16:00-20:00 rather than a whole day).
  fromTime?: string | null;
  toTime?: string | null;
  // Whole days, or hours - ZenHR's own figure for this transaction.
  amount?: number | null;
  partialDay?: boolean;
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
  // ZenHR leave-type ids that represent a business mission. A day covered by
  // one of these was worked: it is never leave and never deducted.
  businessMissionTimeoffIds?: Set<number>;
  today?: DateStr;
}

// Statuses that mean a transaction does NOT cover the day.
//
// Deliberately a deny-list. An allow-list gets this dangerously wrong: any
// status ZenHR uses that we have not seen - a different spelling, a numeric
// code, a workflow state added later - would silently read as "no leave on
// file" and the person would be charged for a day they had properly booked.
// Not charging someone by mistake is recoverable; charging them is not. So
// anything unrecognised counts as covering, and the row names the status so
// a reviewer can see what it was.
const NON_COVERING_TIMEOFF_STATUSES = new Set([
  "cancelled",
  "canceled",
  "withdrawn",
  "rejected",
  "declined",
  "refused",
  "deleted",
  "draft",
  "expired",
  "reverted",
]);

export function statusCoversDay(status: string): boolean {
  return !NON_COVERING_TIMEOFF_STATUSES.has(status.trim().toLowerCase());
}

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
        (t) => coversDay(t, date) && statusCoversDay(t.status)
      );
      if (covering) {
        // A business mission is working time, not leave. It resolves as
        // present with the mission named, and nothing is ever charged for it
        // - whether or not the person also clocked in that day.
        const isMission = input.businessMissionTimeoffIds?.has(covering.timeoffId) ?? false;

        // An hourly permission covers only part of the day. Treating it as a
        // whole day off would hide the rest of that day from review, so it
        // only settles the day when the person also clocked in; otherwise it
        // is a short day for a human to judge.
        if (covering.partialDay && !isMission) {
          const window = `${covering.fromTime ?? "?"}-${covering.toTime ?? "?"}`;
          if (att) {
            rows.push({
              ...base,
              state: "PRESENT",
              timeoffName: covering.timeoffName,
              detail: `Present, with ${covering.timeoffName} ${window} on file${
                base.workedHours !== null ? ` and ${base.workedHours}h clocked` : ""
              }`,
            });
          } else {
            rows.push({
              ...base,
              state: "EXCEPTION",
              timeoffName: covering.timeoffName,
              detail:
                `${covering.timeoffName} ${window} covers only part of the day, and there is no ` +
                `clock-in for the rest of it`,
              suggestedReason: null,
            });
          }
          continue;
        }
        rows.push({
          ...base,
          state: isMission ? "PRESENT" : "TIME_OFF",
          timeoffName: covering.timeoffName,
          detail: isMission
            ? `Working: ${covering.timeoffName} filed in ZenHR${
                base.workedHours !== null ? `, ${base.workedHours}h also clocked` : ""
              }`
            : `Covered by a ${covering.timeoffName} transaction in ZenHR (status: ${
                covering.status || "unspecified"
              })`,
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
        rows.push({
          ...base,
          state: "DAY_OFF",
          detail: emp.daysOffFromShift
            ? "Day off on their ZenHR shift"
            : "Weekly day off (no ZenHR shift assigned - roster default)",
        });
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
          ? "No ZenHR record and no Business Mission filed - he files one whenever he is out, so this is a missing entry rather than a likely absence"
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
