// Applying a deduction: turn a reviewed row into a ZenHR time-off
// transaction, then record what we did.
//
// Two guards matter here. One, a (employmentNumber, date) unique row in
// AppliedDeduction means a replayed or double-clicked Apply cannot charge
// the same day twice. Two, a reason whose bucket is NONE writes nothing to
// ZenHR - it is recorded as reviewed and nothing else.

import { prisma } from "./db";
import { parseDateStr, type DateStr } from "./dates";
import * as zenhr from "./zenhr";
import { hoursToDays } from "./reasons";
import { resolveBranchId } from "./pull";
import type { LeaveBucket } from "@prisma/client";

export interface ApplyRowInput {
  employmentNumber: string;
  date: DateStr;
  reasonCode: string;
  // Overrides the reason's default bucket - this is the Emergency/Annual
  // toggle on the row.
  bucket?: LeaveBucket;
  // Hourly rows (business mission, personal excuse) send hours instead of
  // days; 8 hours = 1 day.
  hours?: number;
  note?: string;
}

export interface ApplyRowResult {
  employmentNumber: string;
  date: DateStr;
  ok: boolean;
  skipped?: boolean;
  message: string;
  zenhrTransactionId?: number;
}

export async function applyRows(
  rows: ApplyRowInput[],
  appliedBy: string
): Promise<ApplyRowResult[]> {
  const results: ApplyRowResult[] = [];
  if (!rows.length) return results;

  const reasons = new Map((await prisma.reason.findMany()).map((r) => [r.code, r]));
  const leaveMaps = new Map((await prisma.leaveTypeMap.findMany()).map((m) => [m.bucket, m]));
  const roster = new Map(
    (await prisma.rosterEmployee.findMany()).map((r) => [r.employmentNumber, r])
  );

  // Only resolved once, and only if a row actually needs to hit ZenHR.
  let branchId: number | null = null;
  const needsWrite = rows.some((r) => {
    const reason = reasons.get(r.reasonCode);
    const bucket = r.bucket ?? reason?.defaultBucket;
    return reason && bucket && bucket !== "NONE";
  });
  if (needsWrite) branchId = await resolveBranchId();

  for (const row of rows) {
    const reason = reasons.get(row.reasonCode);
    if (!reason) {
      results.push({ ...row, ok: false, message: `Unknown reason "${row.reasonCode}"` });
      continue;
    }

    const employee = roster.get(row.employmentNumber);
    if (!employee) {
      results.push({ ...row, ok: false, message: "Not on the roster" });
      continue;
    }
    if (employee.excluded) {
      results.push({
        ...row,
        ok: false,
        message: `${employee.nameEn} is excluded from attendance rules`,
      });
      continue;
    }

    const existing = await prisma.appliedDeduction.findUnique({
      where: {
        employmentNumber_date: { employmentNumber: row.employmentNumber, date: parseDateStr(row.date) },
      },
    });
    if (existing && existing.status === "APPLIED") {
      results.push({
        ...row,
        ok: true,
        skipped: true,
        message: `Already applied on ${existing.appliedAt.toISOString().slice(0, 10)} as ${existing.reasonCode}`,
        zenhrTransactionId: existing.zenhrTransactionId ?? undefined,
      });
      continue;
    }

    const bucket: LeaveBucket = row.bucket ?? reason.defaultBucket;
    const days =
      row.hours !== undefined && reason.hoursEditable ? hoursToDays(row.hours) : reason.defaultDays;
    const note = row.note?.trim() || `${reason.label} - ${row.date} (attendance tool)`;

    // Informational reason: recorded as reviewed, nothing sent to ZenHR.
    if (bucket === "NONE" || days <= 0) {
      await upsertApplied({
        employmentNumber: row.employmentNumber,
        date: row.date,
        reasonCode: reason.code,
        bucket,
        days: 0,
        note,
        status: "APPLIED",
        appliedBy,
      });
      results.push({
        ...row,
        ok: true,
        message: `Recorded as ${reason.label}; no ZenHR transaction needed`,
      });
      continue;
    }

    const leaveType = leaveMaps.get(bucket);
    if (!leaveType?.zenhrTimeoffId) {
      const message = `No ZenHR leave type is mapped to ${bucket} yet - set it at /settings`;
      await upsertApplied({
        employmentNumber: row.employmentNumber,
        date: row.date,
        reasonCode: reason.code,
        bucket,
        days,
        note,
        status: "FAILED",
        errorMessage: message,
        appliedBy,
      });
      results.push({ ...row, ok: false, message });
      continue;
    }
    if (!employee.zenhrEmployeeId || !branchId) {
      const message = "Not matched to a ZenHR employee - run a pull first so the id is resolved";
      await upsertApplied({
        employmentNumber: row.employmentNumber,
        date: row.date,
        reasonCode: reason.code,
        bucket,
        days,
        note,
        status: "FAILED",
        errorMessage: message,
        appliedBy,
      });
      results.push({ ...row, ok: false, message });
      continue;
    }

    try {
      const created = await zenhr.createTimeoffTransactionRequest({
        branchId,
        employeeId: employee.zenhrEmployeeId,
        timeoffId: leaveType.zenhrTimeoffId,
        fromDate: row.date,
        toDate: row.date,
        effectiveDate: row.date,
        notes: note,
      });
      await upsertApplied({
        employmentNumber: row.employmentNumber,
        date: row.date,
        reasonCode: reason.code,
        bucket,
        days,
        note,
        status: "APPLIED",
        zenhrTransactionId: created?.id ?? null,
        appliedBy,
      });
      results.push({
        ...row,
        ok: true,
        message: `${days} day${days === 1 ? "" : "s"} charged to ${bucket.toLowerCase()} in ZenHR`,
        zenhrTransactionId: created?.id,
      });
    } catch (err) {
      const message = (err as Error).message;
      await upsertApplied({
        employmentNumber: row.employmentNumber,
        date: row.date,
        reasonCode: reason.code,
        bucket,
        days,
        note,
        status: "FAILED",
        errorMessage: message,
        appliedBy,
      });
      results.push({ ...row, ok: false, message });
    }
  }

  return results;
}

async function upsertApplied(input: {
  employmentNumber: string;
  date: DateStr;
  reasonCode: string;
  bucket: LeaveBucket;
  days: number;
  note: string;
  status: "APPLIED" | "FAILED";
  zenhrTransactionId?: number | null;
  errorMessage?: string;
  appliedBy: string;
}) {
  const data = {
    reasonCode: input.reasonCode,
    bucket: input.bucket,
    days: input.days,
    note: input.note,
    status: input.status,
    zenhrTransactionId: input.zenhrTransactionId ?? null,
    errorMessage: input.errorMessage ?? null,
    appliedBy: input.appliedBy,
    appliedAt: new Date(),
  };
  await prisma.appliedDeduction.upsert({
    where: {
      employmentNumber_date: {
        employmentNumber: input.employmentNumber,
        date: parseDateStr(input.date),
      },
    },
    create: {
      employmentNumber: input.employmentNumber,
      date: parseDateStr(input.date),
      ...data,
    },
    update: data,
  });
}
