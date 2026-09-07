import { useState } from "react";
import { downloadUrl } from "../api/client";
import PeriodPicker from "../components/PeriodPicker";
import { lastNDays, type Period } from "../lib/period";

export default function Reports() {
  const [period, setPeriod] = useState<Period>(lastNDays(30));

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted text-sm mt-1">All employees, attendance and hours/visits only.</p>
      </div>
      <PeriodPicker period={period} onChange={setPeriod} />
      <div className="bg-white border border-line rounded-xl p-5 flex items-center justify-between">
        <div>
          <div className="font-medium text-sm">Joint report — every employee</div>
          <div className="text-xs text-muted mt-0.5">
            {period.start} to {period.end}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={downloadUrl(`/reports/joint/pdf?period_start=${period.start}&period_end=${period.end}`)}
            className="text-sm border border-line rounded-lg px-3 py-1.5 hover:border-ink/30 transition-colors"
          >
            PDF
          </a>
          <a
            href={downloadUrl(`/reports/joint/excel?period_start=${period.start}&period_end=${period.end}`)}
            className="text-sm border border-line rounded-lg px-3 py-1.5 hover:border-ink/30 transition-colors"
          >
            Excel
          </a>
        </div>
      </div>
      <p className="text-xs text-muted">
        For a single employee's report, open their profile from the directory — it has the same PDF/Excel buttons
        scoped to that person and the period you're viewing.
      </p>
    </div>
  );
}
