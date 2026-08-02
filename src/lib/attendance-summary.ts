import { prisma } from "./db";

export interface DateRange {
  from: Date; // inclusive
  to: Date; // inclusive
}

export interface EmployeeAttendanceSummary {
  employeeId: string;
  employmentNumber: string;
  displayNameEn: string;
  branchId: number;
  workingDays: number;
  daysPresent: number;
  daysAbsent: number;
  totalHours: number;
  missingPunches: number;
  attendanceOnDaysOff: number;
}

function eachDate(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// Working days in range for a branch, based on ZenHR's days_off weekday
// configuration. Does not yet account for public holidays - a reasonable
// phase-1 approximation; can be refined once ZenHR's holiday calendar is
// synced too. Returns the actual set of date strings (not just a count) so
// absences can be matched against specific days rather than a raw total -
// otherwise an employee clocking in on an off day (e.g. overtime) would
// silently cancel out a real absence on an actual working day.
function workingDatesInRange(range: DateRange, daysOff: number[]): Set<string> {
  const daysOffSet = new Set(daysOff);
  const today = new Date();
  const dates = eachDate(range.from, range.to).filter((d) => {
    if (d > today) return false; // don't count future days as "absent"
    return !daysOffSet.has(d.getUTCDay());
  });
  return new Set(dates.map((d) => d.toISOString().slice(0, 10)));
}

export async function getAttendanceSummaries(
  range: DateRange,
  opts: { employeeId?: string; branchId?: number } = {}
): Promise<EmployeeAttendanceSummary[]> {
  const employees = await prisma.employee.findMany({
    where: {
      active: true,
      ...(opts.employeeId ? { id: opts.employeeId } : {}),
      ...(opts.branchId ? { zenhrBranchId: opts.branchId } : {}),
    },
  });

  const branches = await prisma.branch.findMany();
  const branchById = new Map(branches.map((b) => [b.id, b]));

  const summaries: EmployeeAttendanceSummary[] = [];

  for (const emp of employees) {
    const records = await prisma.attendanceRecord.findMany({
      where: {
        employeeId: emp.id,
        attendanceDate: { gte: range.from, lte: range.to },
      },
    });

    const presentDates = new Set(
      records.filter((r) => r.entryTime).map((r) => r.attendanceDate.toISOString().slice(0, 10))
    );
    const totalMinutes = records.reduce((sum, r) => sum + (r.workedMinutes ?? 0), 0);
    const missingPunches = records.filter((r) => r.missingStatus !== "complete").length;

    const branch = branchById.get(emp.zenhrBranchId);
    const workingDates = workingDatesInRange(range, branch?.daysOff ?? [5, 6]);

    const daysPresent = [...workingDates].filter((d) => presentDates.has(d)).length;
    const daysAbsent = workingDates.size - daysPresent;
    const attendanceOnDaysOff = [...presentDates].filter((d) => !workingDates.has(d)).length;

    summaries.push({
      employeeId: emp.id,
      employmentNumber: emp.employmentNumber,
      displayNameEn: emp.displayNameEn,
      branchId: emp.zenhrBranchId,
      workingDays: workingDates.size,
      daysPresent,
      daysAbsent,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      missingPunches,
      attendanceOnDaysOff,
    });
  }

  return summaries.sort((a, b) => a.displayNameEn.localeCompare(b.displayNameEn));
}
