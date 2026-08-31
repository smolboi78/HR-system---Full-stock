import { prisma } from "./db";
import type { DateRange } from "./attendance-summary";

export interface EmployeeVisitSummary {
  employeeId: string;
  employmentNumber: string;
  displayNameEn: string;
  totalVisits: number;
  successfulVisits: number;
}

export async function getVisitSummaries(range: DateRange): Promise<EmployeeVisitSummary[]> {
  const employees = await prisma.employee.findMany({
    where: { active: true, category: "SALES_COLLECTOR" },
  });

  const summaries: EmployeeVisitSummary[] = [];
  for (const emp of employees) {
    const visits = await prisma.visit.findMany({
      where: {
        employeeId: emp.id,
        isPlanned: false,
        visitTime: { gte: range.from, lte: range.to },
      },
    });

    summaries.push({
      employeeId: emp.id,
      employmentNumber: emp.employmentNumber,
      displayNameEn: emp.displayNameEn,
      totalVisits: visits.length,
      successfulVisits: visits.filter((v) => v.isSuccessful).length,
    });
  }

  return summaries.sort((a, b) => b.totalVisits - a.totalVisits);
}
