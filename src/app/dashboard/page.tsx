import { getAttendanceSummaries } from "@/lib/attendance-summary";

function monthToDateRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from, to };
}

export default async function DashboardPage() {
  const range = monthToDateRange();
  const summaries = await getAttendanceSummaries(range);

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Attendance — Month to Date</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        {range.from.toISOString().slice(0, 10)} to {range.to.toISOString().slice(0, 10)}
      </p>

      {summaries.length === 0 ? (
        <p>
          No attendance data yet. Once ZenHR is connected (see Admin) and the sync job has run,
          employees will show up here.
        </p>
      ) : (
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
            {summaries.map((s) => (
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
      )}
    </div>
  );
}

const cellStyle: React.CSSProperties = { padding: "8px 12px" };
