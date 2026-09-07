import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, downloadUrl } from "../api/client";
import type {
  CategoryRule,
  EmployeeCard,
  Holiday,
  NameOverride,
  SyncRun,
  User,
} from "../api/types";
import { CATEGORY_LABEL } from "../lib/category";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-line rounded-xl p-5 space-y-4">
      <div>
        <h2 className="font-medium">{title}</h2>
        {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const CATEGORY_OPTIONS: (keyof typeof CATEGORY_LABEL)[] = [
  "MANAGEMENT",
  "SALES",
  "COLLECTOR",
  "DELIVERY_AGENT",
  "SALES_SUPPORT",
  "EXCLUDED",
];

function NewHiresSection() {
  const qc = useQueryClient();
  const { data: pending } = useQuery({
    queryKey: ["pending-new-hires"],
    queryFn: () => api.get<EmployeeCard[]>("/employees/pending/new-hires"),
  });
  const [choices, setChoices] = useState<Record<string, string>>({});

  const confirm = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) =>
      api.post(`/employees/${id}/confirm`, { category }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-new-hires"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  if (!pending || pending.length === 0) {
    return (
      <Section title="New hires" description="Newly detected ZenHR employees needing confirmation before they appear in the directory.">
        <p className="text-sm text-muted">No pending new hires.</p>
      </Section>
    );
  }

  return (
    <Section title="New hires" description="Confirm the performance category for each new employee before they go live.">
      <div className="space-y-2">
        {pending.map((emp) => (
          <div key={emp.id} className="flex items-center justify-between gap-3 border border-line rounded-lg px-3 py-2">
            <div>
              <div className="text-sm font-medium">{emp.display_name}</div>
              <div className="text-xs text-muted">{emp.job_title ?? "No title on file"}</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="text-sm border border-line rounded-lg px-2 py-1"
                value={choices[emp.id] ?? ""}
                onChange={(e) => setChoices((c) => ({ ...c, [emp.id]: e.target.value }))}
              >
                <option value="" disabled>
                  Choose category…
                </option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
              <button
                disabled={!choices[emp.id]}
                onClick={() => confirm.mutate({ id: emp.id, category: choices[emp.id] })}
                className="text-sm bg-ink text-paper rounded-lg px-3 py-1 disabled:opacity-40"
              >
                Confirm
              </button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function HolidaysSection() {
  const qc = useQueryClient();
  const { data: holidays } = useQuery({ queryKey: ["holidays"], queryFn: () => api.get<Holiday[]>("/settings/holidays") });
  const [date, setDate] = useState("");
  const [name, setName] = useState("");

  const add = useMutation({
    mutationFn: () => api.post("/settings/holidays", { holiday_date: date, name }),
    onSuccess: () => {
      setDate("");
      setName("");
      qc.invalidateQueries({ queryKey: ["holidays"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/holidays/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
  });

  return (
    <Section title="Egypt public holidays" description="Excluded from expected working days. Edit as the official calendar is confirmed year to year.">
      <div className="flex items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-1.5" />
        <input
          placeholder="Holiday name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-sm border border-line rounded-lg px-2 py-1.5 flex-1"
        />
        <button
          disabled={!date || !name}
          onClick={() => add.mutate()}
          className="text-sm bg-ink text-paper rounded-lg px-3 py-1.5 disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-line/70">
        {holidays?.map((h) => (
          <div key={h.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              {h.holiday_date} — {h.name}
            </span>
            <button onClick={() => remove.mutate(h.id)} className="text-xs text-muted hover:text-red-600">
              Remove
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function CategoryRulesSection() {
  const qc = useQueryClient();
  const { data: rules } = useQuery({ queryKey: ["category-rules"], queryFn: () => api.get<CategoryRule[]>("/settings/category-rules") });
  const [jobRole, setJobRole] = useState("");
  const [category, setCategory] = useState<string>("MANAGEMENT");

  const upsert = useMutation({
    mutationFn: () => api.put("/settings/category-rules", { job_role: jobRole, category }),
    onSuccess: () => {
      setJobRole("");
      qc.invalidateQueries({ queryKey: ["category-rules"] });
    },
  });
  const remove = useMutation({
    mutationFn: (role: string) => api.delete(`/settings/category-rules/${encodeURIComponent(role)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["category-rules"] }),
  });

  return (
    <Section title="Job title → category rules" description="Auto-assigns a new employee's metric type from their ZenHR job title.">
      <div className="flex items-center gap-2">
        <input
          placeholder="Job title (exact match)"
          value={jobRole}
          onChange={(e) => setJobRole(e.target.value)}
          className="text-sm border border-line rounded-lg px-2 py-1.5 flex-1"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-1.5">
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <button disabled={!jobRole} onClick={() => upsert.mutate()} className="text-sm bg-ink text-paper rounded-lg px-3 py-1.5 disabled:opacity-40">
          Save
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-line/70">
        {rules?.map((r) => (
          <div key={r.job_role} className="flex items-center justify-between py-2 text-sm">
            <span>
              {r.job_role} → {CATEGORY_LABEL[r.category]}
            </span>
            <button onClick={() => remove.mutate(r.job_role)} className="text-xs text-muted hover:text-red-600">
              Remove
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function NameOverridesSection() {
  const qc = useQueryClient();
  const { data: overrides } = useQuery({ queryKey: ["name-overrides"], queryFn: () => api.get<NameOverride[]>("/settings/name-overrides") });
  const [employmentNumber, setEmploymentNumber] = useState("");
  const [bricksName, setBricksName] = useState("");

  const add = useMutation({
    mutationFn: () => api.post("/settings/name-overrides", { employment_number: employmentNumber, bricks_display_name: bricksName }),
    onSuccess: () => {
      setEmploymentNumber("");
      setBricksName("");
      qc.invalidateQueries({ queryKey: ["name-overrides"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/name-overrides/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["name-overrides"] }),
  });

  return (
    <Section title="ZenHR ↔ Bricks name mapping" description="For employees whose Bricks display name doesn't match their ZenHR name.">
      <div className="flex items-center gap-2">
        <input
          placeholder="ZenHR employment number"
          value={employmentNumber}
          onChange={(e) => setEmploymentNumber(e.target.value)}
          className="text-sm border border-line rounded-lg px-2 py-1.5 w-48"
        />
        <input
          placeholder="Bricks display name"
          value={bricksName}
          onChange={(e) => setBricksName(e.target.value)}
          className="text-sm border border-line rounded-lg px-2 py-1.5 flex-1"
        />
        <button
          disabled={!employmentNumber || !bricksName}
          onClick={() => add.mutate()}
          className="text-sm bg-ink text-paper rounded-lg px-3 py-1.5 disabled:opacity-40"
        >
          Save
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-line/70">
        {overrides?.map((o) => (
          <div key={o.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              #{o.employment_number} → {o.bricks_display_name}
            </span>
            <button onClick={() => remove.mutate(o.id)} className="text-xs text-muted hover:text-red-600">
              Remove
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function UsersSection() {
  const qc = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get<User[]>("/settings/users") });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("VIEWER");

  const add = useMutation({
    mutationFn: () => api.post("/settings/users", { email, name, password, role }),
    onSuccess: () => {
      setEmail("");
      setName("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/settings/users/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <Section title="Users" description="Admins have full access including overrides and settings. View-only users can see everything but can't edit.">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-1.5" />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-1.5" />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="text-sm border border-line rounded-lg px-2 py-1.5"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-1.5">
          <option value="VIEWER">View only</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>
      <button
        disabled={!email || !name || !password}
        onClick={() => add.mutate()}
        className="text-sm bg-ink text-paper rounded-lg px-3 py-1.5 disabled:opacity-40"
      >
        Add user
      </button>
      <div className="divide-y divide-line/70">
        {users?.map((u) => (
          <div key={u.id} className="flex items-center justify-between py-2 text-sm">
            <div>
              <span className="font-medium">{u.name}</span> <span className="text-muted">— {u.email}</span>{" "}
              <span className="text-xs uppercase text-muted">{u.role}</span>
            </div>
            <button
              onClick={() => toggleActive.mutate({ id: u.id, active: !u.active })}
              className="text-xs text-muted hover:text-ink"
            >
              {u.active ? "Deactivate" : "Activate"}
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function SyncSection() {
  const qc = useQueryClient();
  const { data: runs } = useQuery({ queryKey: ["sync-runs"], queryFn: () => api.get<SyncRun[]>("/sync/runs") });
  const runSync = useMutation({
    mutationFn: () => api.post("/sync/run"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sync-runs"] }),
  });

  return (
    <Section title="Data sync" description="Pulls the trailing 10-day window from ZenHR and Bricks. Runs on a schedule; you can also trigger it manually.">
      <div className="flex items-center gap-2">
        <a
          href={downloadUrl("/sync/zenhr/connect")}
          className="text-sm border border-line rounded-lg px-3 py-1.5 hover:border-ink/30 transition-colors"
        >
          Connect ZenHR
        </a>
        <button
          onClick={() => runSync.mutate()}
          disabled={runSync.isPending}
          className="text-sm bg-ink text-paper rounded-lg px-3 py-1.5 disabled:opacity-40"
        >
          {runSync.isPending ? "Syncing…" : "Sync now"}
        </button>
      </div>
      <p className="text-xs text-muted">
        "Connect ZenHR" is a one-time step — it takes you to ZenHR to approve access, then brings you back here.
        Do this once (or again if the connection is ever revoked) before using "Sync now".
      </p>
      {runSync.isError && <p className="text-sm text-red-600">Sync failed — see the run log below.</p>}
      <div className="max-h-64 overflow-y-auto divide-y divide-line/70">
        {runs?.map((r) => (
          <div key={r.id} className="py-2 text-sm flex items-center justify-between">
            <span>
              {r.source} — {new Date(r.started_at).toLocaleString()}
            </span>
            <span
              className={
                r.status === "SUCCESS" ? "text-green-700" : r.status === "FAILED" ? "text-red-600" : "text-muted"
              }
            >
              {r.status === "SUCCESS" ? `${r.records_synced} records` : r.status === "FAILED" ? r.error_message : "Running…"}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ZenhrConnectBanner() {
  const params = new URLSearchParams(window.location.search);
  const zenhr = params.get("zenhr");
  if (!zenhr) return null;

  if (zenhr === "connected") {
    return (
      <div className="text-sm bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3">
        ZenHR connected. Use "Sync now" below to pull data.
      </div>
    );
  }
  return (
    <div className="text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3">
      Couldn't connect ZenHR ({params.get("reason") ?? "unknown error"}). Double-check the client ID/secret and
      redirect URI, then try "Connect ZenHR" again.
    </div>
  );
}

export default function Settings() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted text-sm mt-1">Admin only.</p>
      </div>
      <ZenhrConnectBanner />
      <NewHiresSection />
      <SyncSection />
      <HolidaysSection />
      <CategoryRulesSection />
      <NameOverridesSection />
      <UsersSection />
    </div>
  );
}
