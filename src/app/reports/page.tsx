"use client";

import { useState } from "react";

function defaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

export default function ReportsPage() {
  const [range, setRange] = useState(defaultRange());

  const query = `from=${range.from}&to=${range.to}`;

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ fontSize: 22 }}>Attendance Reports</h1>
      <p style={{ color: "#555" }}>
        Download a per-employee attendance report (working days, present, absent, total hours,
        missing punches) for a date range.
      </p>

      <div style={{ display: "flex", gap: 16, margin: "16px 0" }}>
        <label>
          From
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            style={{ display: "block", padding: 8 }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            style={{ display: "block", padding: 8 }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <a href={`/api/reports/excel?${query}`}>
          <button style={{ padding: "10px 16px" }}>Download Excel</button>
        </a>
        <a href={`/api/reports/pdf?${query}`}>
          <button style={{ padding: "10px 16px" }}>Download PDF</button>
        </a>
      </div>
    </div>
  );
}
