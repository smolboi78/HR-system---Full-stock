import { getAttendanceSummaries, type EmployeeAttendanceSummary } from "@/lib/attendance-summary";
import { getVisitSummaries } from "@/lib/visit-summary";

function monthToDateRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from, to };
}

export default async function DashboardPage() {
  const range = monthToDateRange();
  const [summaries, visitSummaries] = await Promise.all([
    getAttendanceSummaries(range),
    getVisitSummaries(range),
  ]);

  const visitsByEmployeeId = new Map(visitSummaries.map((v) => [v.employeeId, v]));

  const management = summaries.filter((s) => s.category === "MANAGEMENT");
  const salesCollectors = summaries.filter((s) => s.category === "SALES_COLLECTOR");
  const deliveryAgents = summaries.filter((s) => s.category === "DELIVERY_AGENT");
  const uncategorized = summaries.filter((s) => s.category === "OTHER");

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Attendance & Performance — Month to Date</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        {range.from.toISOString().slice(0, 10)} to {range.to.toISOString().slice(0, 10)}
      </p>

      {summaries.length === 0 ? (
        <p>
          No attendance data yet. Once ZenHR is connected (see Admin) and the sync job has run,
          employees will show up here.
        </p>
      ) : (
        <>
          <Section title="Management & Warehouse — Hours Worked">
            <HoursTable rows={management} />
          </Section>

          <Section title="Sales & Collectors — Visit Count">
            <VisitTable
              rows={salesCollectors}
              visitsByEmployeeId={visitsByEmployeeId}
            />
          </Section>

          <Section title="Delivery Agents (Pending) — Attendance Only">
            <p style={{ color: "#555", fontSize: 13, marginTop: 0 }}>
              Delivery agents are tracked in ZenHR only (since Aug 23, 2026) — no Bricks visit
              data applies to this group.
            </p>
            <HoursTable rows={deliveryAgents} />
          </Section>

          {uncategorized.length > 0 && (
            <Section title="Uncategorized">
              <p style={{ color: "#b45309", fontSize: 13, marginTop: 0 }}>
                These employees' ZenHR job role doesn't match a known category rule yet — add
                one in the JobRoleCategoryRule table.
              </p>
              <HoursTable rows={uncategorized} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 17, marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function HoursTable({ rows }: { rows: EmployeeAttendanceSummary[] }) {
  if (rows.length === 0) return <p style={{ color: "#777" }}>No employees in this category.</p>;
  return (
    <table style={{ borderCollapse: "collapse", width: "100%", background: "white" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
          <th style={cellStyle}>Employee</th>
          <th style={cellStyle}>Emp. No.</th>
          <th style={cellStyle}>Working Days</th>
          <th style={cellStyle}>Present</th>
          <th style={cellStyle}>Absent</th>
          <th style={cellStyle}>Total Hours</th>
          <th style={cellStyle}>Missing Punches</th>
          <th style={cellStyle}>Attended On Day Off</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.employeeId} style={{ borderBottom: "1px solid #eee" }}>
            <td style={cellStyle}>{s.displayNameEn}</td>
            <td style={cellStyle}>{s.employmentNumber}</td>
            <td style={cellStyle}>{s.workingDays}</td>
            <td style={cellStyle}>{s.daysPresent}</td>
            <td style={cellStyle}>{s.daysAbsent}</td>
            <td style={cellStyle}>{s.totalHours.toFixed(1)}</td>
            <td style={cellStyle}>
              {s.missingPunches > 0 ? (
                <span style={{ color: "#b45309" }}>{s.missingPunches}</span>
              ) : (
                0
              )}
            </td>
            <td style={cellStyle}>{s.attendanceOnDaysOff}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VisitTable({
  rows,
  visitsByEmployeeId,
}: {
  rows: EmployeeAttendanceSummary[];
  visitsByEmployeeId: Map<string, { totalVisits: number; successfulVisits: number }>;
}) {
  if (rows.length === 0) return <p style={{ color: "#777" }}>No employees in this category.</p>;
  return (
    <table style={{ borderCollapse: "collapse", width: "100%", background: "white" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
          <th style={cellStyle}>Employee</th>
          <th style={cellStyle}>Emp. No.</th>
          <th style={cellStyle}>Present Days</th>
          <th style={cellStyle}>Absent Days</th>
          <th style={cellStyle}>Missing Punches</th>
          <th style={cellStyle}>Total Visits</th>
          <th style={cellStyle}>Successful Visits</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          const visits = visitsByEmployeeId.get(s.employeeId);
          return (
            <tr key={s.employeeId} style={{ borderBottom: "1px solid #eee" }}>
              <td style={cellStyle}>{s.displayNameEn}</td>
              <td style={cellStyle}>{s.employmentNumber}</td>
              <td style={cellStyle}>{s.daysPresent}</td>
              <td style={cellStyle}>{s.daysAbsent}</td>
              <td style={cellStyle}>
                {s.missingPunches > 0 ? (
                  <span style={{ color: "#b45309" }}>{s.missingPunches}</span>
                ) : (
                  0
                )}
              </td>
              <td style={cellStyle}>{visits?.totalVisits ?? 0}</td>
              <td style={cellStyle}>{visits?.successfulVisits ?? 0}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const cellStyle: React.CSSProperties = { padding: "8px 12px" };
