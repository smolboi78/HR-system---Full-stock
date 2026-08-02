import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getAttendanceSummaries } from "@/lib/attendance-summary";
import { parseRange } from "../range";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const range = parseRange(req);
  const summaries = await getAttendanceSummaries(range);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Attendance");

  sheet.columns = [
    { header: "Employee", key: "displayNameEn", width: 28 },
    { header: "Emp. No.", key: "employmentNumber", width: 12 },
    { header: "Working Days", key: "workingDays", width: 14 },
    { header: "Present", key: "daysPresent", width: 10 },
    { header: "Absent", key: "daysAbsent", width: 10 },
    { header: "Total Hours", key: "totalHours", width: 12 },
    { header: "Missing Punches", key: "missingPunches", width: 16 },
    { header: "Attended On Day Off", key: "attendanceOnDaysOff", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };
  summaries.forEach((s) => sheet.addRow(s));

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `attendance-report_${range.from.toISOString().slice(0, 10)}_${range.to
    .toISOString()
    .slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
