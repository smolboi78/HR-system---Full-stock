import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Department, EmployeeCard as EmployeeCardType } from "../api/types";
import EmployeeCard from "../components/EmployeeCard";
import PeriodPicker from "../components/PeriodPicker";
import { lastNDays, type Period } from "../lib/period";

const ALL_DEPARTMENTS = "ALL";

export default function Directory() {
  const [period, setPeriod] = useState<Period>(lastNDays(30));
  const [department, setDepartment] = useState<string>(ALL_DEPARTMENTS);
  const [search, setSearch] = useState("");

  const { data: employees, isLoading, error } = useQuery({
    queryKey: ["employees", period.start, period.end],
    queryFn: () => api.get<EmployeeCardType[]>(`/employees?period_start=${period.start}&period_end=${period.end}`),
  });

  const { data: orgGroups } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Department[]>("/employees/departments"),
  });

  // Tabs are Full Stock's six org-chart groups, served in the chart's own
  // order - deliberately not sorted, and not ZenHR's raw department names.
  // Anyone whose role/department doesn't map to a group gets a trailing
  // tab of their own rather than silently disappearing from the directory.
  const departments = useMemo(() => {
    const groups = (orgGroups ?? []).map((d) => d.name);
    const leftovers = (employees ?? [])
      .map((e) => e.org_group)
      .filter((g) => g && !groups.includes(g));
    return [...groups, ...Array.from(new Set(leftovers))];
  }, [orgGroups, employees]);

  const filtered = useMemo(() => {
    if (!employees) return [];
    return employees.filter((e) => {
      if (department !== ALL_DEPARTMENTS && e.org_group !== department) return false;
      if (search && !e.display_name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [employees, department, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employee directory</h1>
          <p className="text-muted text-sm mt-1">{filtered.length} people</p>
        </div>
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>

      {departments.length > 0 && (
        <div className="flex items-center gap-1 border-b border-line overflow-x-auto">
          {[ALL_DEPARTMENTS, ...departments].map((d) => (
            <button
              key={d}
              onClick={() => setDepartment(d)}
              className={`px-4 py-2.5 text-sm whitespace-nowrap -mb-px border-b-2 transition-colors ${
                department === d ? "border-ink text-ink font-medium" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {d === ALL_DEPARTMENTS ? "All departments" : d}
            </button>
          ))}
        </div>
      )}

      <input
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="text-sm border border-line rounded-lg px-3 py-1.5 bg-white w-56 focus:outline-none focus:ring-2 focus:ring-accent/30"
      />

      {isLoading && <div className="text-muted text-sm py-12 text-center">Loading directory…</div>}
      {error && <div className="text-red-600 text-sm py-12 text-center">Couldn't load employees.</div>}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="text-muted text-sm py-16 text-center">No employees match this filter.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((e) => (
          <EmployeeCard key={e.id} employee={e} />
        ))}
      </div>
    </div>
  );
}
