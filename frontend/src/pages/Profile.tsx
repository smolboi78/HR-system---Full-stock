import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, authedUrl } from "../api/client";
import type { EmployeeProfile } from "../api/types";
import Avatar from "../components/Avatar";
import PeriodPicker from "../components/PeriodPicker";
import { lastNDays, type Period } from "../lib/period";
import { CATEGORY_LABEL } from "../lib/category";
import { useAuth } from "../context/AuthContext";

type Tab = "attendance" | "timeoff" | "visits";

const TAB_LABEL: Record<Tab, string> = { attendance: "Attendance", timeoff: "Time off", visits: "Visits" };

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-line rounded-xl px-5 py-4">
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted mt-1">{label}</div>
    </div>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function Profile() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>(lastNDays(30));
  const [tab, setTab] = useState<Tab>("attendance");
  const [balanceDraft, setBalanceDraft] = useState("");

  const { data: profile, isLoading, error, refetch } = useQuery({
    queryKey: ["employee", id, period.start, period.end],
    queryFn: () =>
      api.get<EmployeeProfile>(`/employees/${id}?period_start=${period.start}&period_end=${period.end}`),
    enabled: !!id,
  });

  async function saveBalance() {
    if (!id) return;
    const value = balanceDraft.trim() === "" ? null : Number(balanceDraft);
    await api.put(`/employees/${id}/vacation-balance`, { balance_days: value });
    refetch();
  }

  if (isLoading) return <div className="text-muted text-sm py-12 text-center">Loading profile…</div>;
  if (error || !profile) return <div className="text-red-600 text-sm py-12 text-center">Couldn't load this employee.</div>;

  const showHours = profile.category === "MANAGEMENT" || profile.category === "DELIVERY_AGENT";
  const showVisits =
    profile.category === "SALES" || profile.category === "COLLECTOR" || profile.category === "DELIVERY_AGENT";

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-muted hover:text-ink">
        ← Directory
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={profile.display_name} photoUrl={profile.photo_url} size={64} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{profile.display_name}</h1>
            <p className="text-muted text-sm mt-0.5">
              {profile.job_title ?? CATEGORY_LABEL[profile.category]}
              {profile.department ? ` · ${profile.department}` : ""} · {CATEGORY_LABEL[profile.category]}
            </p>
            {profile.manager_name && <p className="text-muted text-xs mt-0.5">Reports to {profile.manager_name}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PeriodPicker period={period} onChange={setPeriod} />
          <a
            href={authedUrl(`/reports/employee/${id}/pdf?period_start=${period.start}&period_end=${period.end}`)}
            className="text-sm border border-line rounded-lg px-3 py-1.5 hover:border-ink/30 transition-colors"
          >
            PDF
          </a>
          <a
            href={authedUrl(`/reports/employee/${id}/excel?period_start=${period.start}&period_end=${period.end}`)}
            className="text-sm border border-line rounded-lg px-3 py-1.5 hover:border-ink/30 transition-colors"
          >
            Excel
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {showHours && <StatTile label="Hours worked" value={profile.period_hours} />}
        {showVisits && <StatTile label="Visits" value={profile.period_visits} />}
        <StatTile label="Days present" value={`${profile.period_days_present}/${profile.period_days_expected}`} />
        <StatTile label="Days absent" value={profile.period_days_absent} />
      </div>

      <div className="bg-white border border-line rounded-xl p-5 flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="text-sm text-muted">Vacation balance</div>
          <div className="text-2xl font-semibold tracking-tight mt-1">
            {profile.vacation_balance_days ?? "—"} <span className="text-sm font-normal text-muted">days</span>
          </div>
          <div className="text-xs text-muted mt-1">Maintained manually - ZenHR has no live balance to sync from.</div>
        </div>
        {user?.role === "ADMIN" && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.5"
              placeholder="Balance days"
              value={balanceDraft}
              onChange={(e) => setBalanceDraft(e.target.value)}
              className="w-32 text-sm border border-line rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <button
              onClick={saveBalance}
              className="text-sm bg-ink text-paper rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1 border-b border-line">
          {(["attendance", "timeoff", "visits"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm -mb-px border-b-2 transition-colors ${
                tab === t ? "border-ink text-ink font-medium" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        <div className="pt-4">
          {tab === "attendance" && (
            <Table
              rows={profile.attendance}
              empty="No attendance records in this period."
              columns={["Date", "Entry", "Exit", "Hours", "Status"]}
              render={(r) => [
                fmtDate(r.attendance_date),
                fmtTime(r.entry_time),
                fmtTime(r.exit_time),
                r.worked_minutes != null ? (r.worked_minutes / 60).toFixed(1) : "—",
                r.status.replace(/_/g, " "),
              ]}
            />
          )}
          {tab === "timeoff" && (
            <Table
              rows={profile.timeoff}
              empty="No leave or vacation transactions in this period."
              columns={["From", "To", "Type", "Amount", "Status"]}
              render={(r) => [
                fmtDate(r.from_date),
                fmtDate(r.to_date),
                r.type_name ?? (r.is_vacation ? "Vacation" : "Leave"),
                r.amount,
                r.status.replace(/_/g, " "),
              ]}
            />
          )}
          {tab === "visits" && (
            <Table
              rows={profile.visits}
              empty="No visits in this period."
              columns={["Time", "Contact", "Status", "Outcome"]}
              render={(r) => [
                new Date(r.visit_time).toLocaleString(),
                r.contact_name ?? "—",
                r.status,
                r.is_successful == null ? "—" : r.is_successful ? "Successful" : "Unsuccessful",
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Table<T>({
  rows,
  columns,
  render,
  empty,
}: {
  rows: T[];
  columns: string[];
  render: (row: T) => (string | number)[];
  empty: string;
}) {
  if (rows.length === 0) return <div className="text-muted text-sm py-10 text-center">{empty}</div>;
  return (
    <div className="overflow-x-auto border border-line rounded-xl bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted uppercase tracking-wide">
            {columns.map((c) => (
              <th key={c} className="px-4 py-2.5 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {render(row).map((cell, j) => (
                <td key={j} className="px-4 py-2.5 capitalize">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
