import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, authedUrl } from "../api/client";
import type {
  CategoryRule,
  Department,
  DepartmentRule,
  EmployeeOverride,
  Holiday,
  NameOverride,
  SyncRun,
  UnmatchedRep,
  UnsortedEmployee,
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

const AUTO_GROUP = "";

function EmployeeOverridesSection() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { title: string; group: string; section: string }>>({});

  const { data: rows } = useQuery({
    queryKey: ["employee-overrides"],
    queryFn: () => api.get<EmployeeOverride[]>("/settings/employee-overrides"),
  });
  const { data: groups } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Department[]>("/employees/departments"),
  });

  const save = useMutation({
    mutationFn: ({ id, title, group, section }: { id: string; title: string; group: string; section: string }) =>
      // section must go with every save: omitting it would clear a placement
      // made in the unsorted-employees list.
      api.put(`/settings/employee-overrides/${id}`, {
        job_title: title,
        org_group: group,
        org_section: group ? section || null : null,
      }),
    onSuccess: (_data, vars) => {
      setDrafts((d) => {
        const next = { ...d };
        delete next[vars.id];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["employee-overrides"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  const filtered = (rows ?? []).filter((r) =>
    search ? r.display_name.toLowerCase().includes(search.toLowerCase()) : true
  );

  const sectionsOf = (group: string) => groups?.find((g) => g.name === group)?.sections ?? [];

  const draftFor = (row: EmployeeOverride) =>
    drafts[row.id] ?? {
      title: row.job_title_override ?? "",
      group: row.org_group_override ?? AUTO_GROUP,
      section: row.org_section_override ?? "",
    };

  const isDirty = (row: EmployeeOverride) => {
    const d = drafts[row.id];
    if (!d) return false;
    return (
      d.title !== (row.job_title_override ?? "") ||
      d.group !== (row.org_group_override ?? AUTO_GROUP) ||
      d.section !== (row.org_section_override ?? "")
    );
  };

  return (
    <Section
      title="Employee titles & departments"
      description="Correct anyone whose ZenHR job title or department puts them in the wrong place. These corrections survive every sync — ZenHR's own values are kept underneath and shown in grey. Leave a field blank to go back to ZenHR's value."
    >
      <input
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="text-sm border border-line rounded-lg px-3 py-1.5 bg-white w-56 focus:outline-none focus:ring-2 focus:ring-accent/30"
      />

      {!rows && <p className="text-sm text-muted">Loading employees…</p>}
      {rows && filtered.length === 0 && <p className="text-sm text-muted">No employees match that search.</p>}

      <div className="space-y-2">
        {filtered.map((row) => {
          const draft = draftFor(row);
          const dirty = isDirty(row);
          return (
            <div key={row.id} className="border border-line rounded-lg px-3 py-2.5 space-y-2">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="text-sm font-medium">{row.display_name}</div>
                <div className="text-[11px] text-muted">
                  ZenHR: {row.synced_job_title || "no title"}
                  {row.synced_department ? ` · ${row.synced_department}` : ""} → currently in{" "}
                  <span className="font-medium text-ink">{row.effective_org_group}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  placeholder={row.synced_job_title || "Job title"}
                  value={draft.title}
                  onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: { ...draft, title: e.target.value } }))}
                  className="text-sm border border-line rounded-lg px-2 py-1 flex-1 min-w-[12rem]"
                />
                <select
                  value={draft.group}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [row.id]: { ...draft, group: e.target.value, section: "" } }))
                  }
                  className="text-sm border border-line rounded-lg px-2 py-1"
                >
                  <option value={AUTO_GROUP}>Auto (from title)</option>
                  {(groups ?? []).map((g) => (
                    <option key={g.name} value={g.name}>
                      {g.name}
                    </option>
                  ))}
                </select>
                {sectionsOf(draft.group).length > 0 && (
                  <select
                    value={draft.section}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: { ...draft, section: e.target.value } }))}
                    className="text-sm border border-line rounded-lg px-2 py-1"
                  >
                    <option value="">Auto (from title)</option>
                    {sectionsOf(draft.group).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  disabled={!dirty || save.isPending}
                  onClick={() =>
                    save.mutate({ id: row.id, title: draft.title, group: draft.group, section: draft.section })
                  }
                  className="text-sm bg-ink text-paper rounded-lg px-3 py-1 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          );
        })}
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
    <Section
      title="Job title → category rules"
      description="Auto-assigns a new employee's metric type from their ZenHR job title. Used as a fallback when no department rule matches."
    >
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

function DepartmentRulesSection() {
  const qc = useQueryClient();
  const { data: rules } = useQuery({ queryKey: ["department-rules"], queryFn: () => api.get<DepartmentRule[]>("/settings/department-rules") });
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState<string>("MANAGEMENT");

  const upsert = useMutation({
    mutationFn: () => api.put("/settings/department-rules", { department, category }),
    onSuccess: () => {
      setDepartment("");
      qc.invalidateQueries({ queryKey: ["department-rules"] });
    },
  });
  const remove = useMutation({
    mutationFn: (dept: string) => api.delete(`/settings/department-rules/${encodeURIComponent(dept)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["department-rules"] }),
  });

  return (
    <Section
      title="Department → category rules"
      description="Auto-assigns a new employee's metric type from their ZenHR department - checked before job title rules."
    >
      <div className="flex items-center gap-2">
        <input
          placeholder="Department (exact match)"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="text-sm border border-line rounded-lg px-2 py-1.5 flex-1"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-1.5">
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <button disabled={!department} onClick={() => upsert.mutate()} className="text-sm bg-ink text-paper rounded-lg px-3 py-1.5 disabled:opacity-40">
          Save
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-line/70">
        {rules?.map((r) => (
          <div key={r.department} className="flex items-center justify-between py-2 text-sm">
            <span>
              {r.department} → {CATEGORY_LABEL[r.category]}
            </span>
            <button onClick={() => remove.mutate(r.department)} className="text-xs text-muted hover:text-red-600">
              Remove
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function UnsortedEmployeesSection() {
  const qc = useQueryClient();
  const { data: unsorted } = useQuery({
    queryKey: ["unsorted-employees"],
    queryFn: () => api.get<UnsortedEmployee[]>("/settings/unsorted-employees"),
  });
  const { data: groups } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Department[]>("/employees/departments"),
  });
  const [drafts, setDrafts] = useState<Record<string, { group: string; section: string }>>({});

  const sort = useMutation({
    mutationFn: ({ id, group, section }: { id: string; group: string; section: string }) =>
      api.post(`/settings/unsorted-employees/${id}/sort`, { org_group: group, org_section: section || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unsorted-employees"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-overrides"] });
    },
  });

  // Nothing left to sort: the section disappears rather than sitting there
  // empty. A later sync bringing in a new hire puts it straight back.
  if (!unsorted || unsorted.length === 0) return null;

  const sectionsOf = (group: string) => groups?.find((g) => g.name === group)?.sections ?? [];

  return (
    <Section
      title={`Unsorted employees (${unsorted.length})`}
      description="Nobody appears in the directory until you place them. Pick a department — and a section where the department has them — for each person."
    >
      <div className="divide-y divide-line/70">
        {unsorted.map((emp) => {
          const draft = drafts[emp.id] ?? {
            group: emp.suggested_group,
            section: emp.suggested_section ?? "",
          };
          const sections = sectionsOf(draft.group);
          const needsSection = sections.length > 0;
          const ready = Boolean(draft.group) && (!needsSection || Boolean(draft.section));

          return (
            <div key={emp.id} className="py-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[11rem]">
                <div className="text-sm font-medium">{emp.display_name}</div>
                <div className="text-xs text-muted mt-0.5">
                  {emp.job_title || "no title"}
                  {emp.department ? ` · ${emp.department}` : ""}
                </div>
                {!emp.suggested_group && (
                  <div className="text-[11px] text-amber-700 mt-0.5">
                    Their title matches no department — pick one.
                  </div>
                )}
              </div>

              <select
                value={draft.group}
                onChange={(e) =>
                  // The old section can't exist under a new department.
                  setDrafts((d) => ({ ...d, [emp.id]: { group: e.target.value, section: "" } }))
                }
                className="text-sm border border-line rounded-lg px-2 py-1.5 bg-white"
              >
                {/* Without this, a row with no suggestion would display the
                    first department while holding "" - so Place would look
                    ready and file them somewhere nobody chose. */}
                <option value="">Department…</option>
                {(groups ?? []).map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </select>

              {needsSection && (
                <select
                  value={draft.section}
                  onChange={(e) => setDrafts((d) => ({ ...d, [emp.id]: { ...draft, section: e.target.value } }))}
                  className="text-sm border border-line rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="">Section…</option>
                  {sections.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}

              <button
                disabled={!ready || sort.isPending}
                onClick={() => sort.mutate({ id: emp.id, group: draft.group, section: draft.section })}
                className="text-sm bg-ink text-paper rounded-lg px-3 py-1.5 disabled:opacity-40"
              >
                Place
              </button>
            </div>
          );
        })}
      </div>

      {sort.isError && (
        <p className="text-sm text-red-600">Couldn't place them — {(sort.error as Error).message}</p>
      )}
    </Section>
  );
}

function UnmatchedRepsSection() {
  const qc = useQueryClient();
  const { data: reps } = useQuery({
    queryKey: ["unmatched-reps"],
    queryFn: () => api.get<UnmatchedRep[]>("/settings/unmatched-reps"),
  });
  const { data: employees } = useQuery({
    queryKey: ["employee-overrides"],
    queryFn: () => api.get<EmployeeOverride[]>("/settings/employee-overrides"),
  });
  const [picks, setPicks] = useState<Record<string, string>>({});

  const link = useMutation({
    mutationFn: (rep: UnmatchedRep) =>
      api.post("/settings/unmatched-reps/link", {
        owner_bricks_id: rep.owner_bricks_id,
        employee_id: picks[rep.owner_bricks_id],
      }),
    onSuccess: () => {
      // The rep leaves this list and their visits land on the employee, so
      // the directory and every profile need refetching too.
      qc.invalidateQueries({ queryKey: ["unmatched-reps"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee"] });
    },
  });

  const totalStranded = (reps ?? []).reduce((sum, r) => sum + r.visit_count, 0);

  return (
    <Section
      title="Unlinked Bricks reps"
      description="Bricks accounts whose visits match nobody in ZenHR. Their visits are already synced — they just aren't counted against anyone until you link them here."
    >
      {reps?.length === 0 && (
        <p className="text-sm text-muted">Every synced visit is linked to an employee.</p>
      )}

      {reps && reps.length > 0 && (
        <p className="text-xs text-amber-700">
          {totalStranded} visit{totalStranded === 1 ? "" : "s"} across {reps.length} account
          {reps.length === 1 ? "" : "s"} aren't counted against anyone.
        </p>
      )}

      <div className="divide-y divide-line/70">
        {reps?.map((rep) => (
          <div key={rep.owner_bricks_id} className="py-3 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[12rem]">
              <div className="text-sm font-medium">{rep.owner_name_raw}</div>
              <div className="text-xs text-muted mt-0.5">
                {rep.visit_count} visit{rep.visit_count === 1 ? "" : "s"} · last{" "}
                {new Date(rep.last_visit_at).toLocaleDateString()}
              </div>
            </div>
            <select
              value={picks[rep.owner_bricks_id] ?? ""}
              onChange={(e) => setPicks((p) => ({ ...p, [rep.owner_bricks_id]: e.target.value }))}
              className="text-sm border border-line rounded-lg px-2 py-1.5 bg-white min-w-[14rem]"
            >
              <option value="">Link to employee…</option>
              {employees?.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.display_name}
                  {emp.effective_job_title ? ` — ${emp.effective_job_title}` : ""}
                </option>
              ))}
            </select>
            <button
              disabled={!picks[rep.owner_bricks_id] || link.isPending}
              onClick={() => link.mutate(rep)}
              className="text-sm bg-ink text-paper rounded-lg px-3 py-1.5 disabled:opacity-40"
            >
              Link
            </button>
          </div>
        ))}
      </div>

      {link.isError && (
        <p className="text-sm text-red-600">Couldn't link that account — {(link.error as Error).message}</p>
      )}
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
          href={authedUrl("/sync/zenhr/connect")}
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
      <SyncSection />
      <UnsortedEmployeesSection />
      <UnmatchedRepsSection />
      <EmployeeOverridesSection />
      <HolidaysSection />
      <DepartmentRulesSection />
      <CategoryRulesSection />
      <NameOverridesSection />
      <UsersSection />
    </div>
  );
}
