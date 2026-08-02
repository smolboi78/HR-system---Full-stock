import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { getAttendanceSummaries, type EmployeeAttendanceSummary } from "@/lib/attendance-summary";
import { parseRange } from "../range";
import { getSession } from "@/lib/session";

function buildPdf(summaries: EmployeeAttendanceSummary[], from: string, to: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text("Attendance Report", { align: "left" });
    doc.fontSize(10).fillColor("#555").text(`${from} to ${to}`);
    doc.moveDown();

    const columns = [
      { key: "displayNameEn", label: "Employee", width: 140 },
      { key: "employmentNumber", label: "Emp. No.", width: 60 },
      { key: "workingDays", label: "Work Days", width: 60 },
      { key: "daysPresent", label: "Present", width: 55 },
      { key: "daysAbsent", label: "Absent", width: 55 },
      { key: "totalHours", label: "Hours", width: 55 },
      { key: "missingPunches", label: "Missing", width: 60 },
      { key: "attendanceOnDaysOff", label: "On Day Off", width: 60 },
    ] as const;

    const startX = doc.x;
    let y = doc.y + 10;

    doc.fontSize(9).fillColor("#000");
    let x = startX;
    for (const col of columns) {
      doc.text(col.label, x, y, { width: col.width, continued: false });
      x += col.width;
    }
    y += 16;
    doc.moveTo(startX, y - 4).lineTo(x, y - 4).strokeColor("#ccc").stroke();

    for (const row of summaries) {
      x = startX;
      if (y > 760) {
        doc.addPage();
        y = doc.y;
      }
      for (const col of columns) {
        const value = row[col.key as keyof EmployeeAttendanceSummary];
        doc.text(String(value), x, y, { width: col.width });
        x += col.width;
      }
      y += 16;
    }

    doc.end();
  });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const range = parseRange(req);
  const summaries = await getAttendanceSummaries(range);
  const from = range.from.toISOString().slice(0, 10);
  const to = range.to.toISOString().slice(0, 10);

  const buffer = await buildPdf(summaries, from, to);
  const filename = `attendance-report_${from}_${to}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
