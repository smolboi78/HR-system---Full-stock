"use client";

import { useState } from "react";

export interface RosterRow {
  employmentNumber: string;
  nameEn: string;
  role: string;
  tracking: "HOURS" | "PRESENCE" | "DELIVERY";
  excluded: boolean;
  daysOff: number[];
  bricksAlias: string | null;
  zenhrEmployeeId: number | null;
  active: boolean;
}

const TRACKING_LABEL: Record<RosterRow["tracking"], string> = {
  HOURS: "Hours",
  PRESENCE: "Presence",
  DELIVERY: "Delivery",
};

const BLANK: RosterRow = {
  employmentNumber: "",
  nameEn: "",
  role: "",
  tracking: "PRESENCE",
  excluded: false,
  daysOff: [5, 6],
  bricksAlias: null,
  zenhrEmployeeId: null,
  active: true,
};

export function RosterEditor({ initial }: { initial: RosterRow[] }) {
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<RosterRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(row: RosterRow) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/roster", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employmentNumber: row.employmentNumber.trim(),
          nameEn: row.nameEn.trim(),
          role: row.role.trim(),
          tracking: row.tracking,
          excluded: row.excluded,
          daysOff: row.daysOff,
          bricksAlias: row.bricksAlias?.trim() || null,
          active: row.active,
        }),
      });
      const json = (await res.json()) as { row?: RosterRow; error?: string };
      if (!res.ok) throw new Error(json.error || "Could not save");
      setRows((prev) => {
        const without = prev.filter((r) => r.employmentNumber !== row.employmentNumber);
        return [...without, { ...row, ...json.row }].sort((a, b) =>
          a.employmentNumber.localeCompare(b.employmentNumber)
        );
      });
      setEditing(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="notice alert">{error}</div>}

      {editing && (
        <section className="card">
          <h2>
            {rows.some((r) => r.employmentNumber === editing.employmentNumber)
              ? `Editing ${editing.employmentNumber}`
              : "New roster entry"}
          </h2>
          <div className="row" style={{ marginTop: 16 }}>
            <div>
              <label htmlFor="num">ID</label>
              <input
                id="num"
                style={{ width: 90 }}
                value={editing.employmentNumber}
                onChange={(e) => setEditing({ ...editing, employmentNumber: e.target.value })}
              />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="name">Name</label>
              <input
                id="name"
                style={{ width: "100%" }}
                value={editing.nameEn}
                onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
              />
            </div>
            <div style={{ minWidth: 180 }}>
              <label htmlFor="role">Role</label>
              <input
                id="role"
                style={{ width: "100%" }}
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="tracking">Tracking</label>
              <select
                id="tracking"
                value={editing.tracking}
                onChange={(e) =>
                  setEditing({ ...editing, tracking: e.target.value as RosterRow["tracking"] })
                }
              >
                <option value="HOURS">Hours matter</option>
                <option value="PRESENCE">Presence only</option>
                <option value="DELIVERY">Delivery agent</option>
              </select>
            </div>
            <div style={{ minWidth: 180 }}>
              <label htmlFor="alias">Bricks name</label>
              <input
                id="alias"
                style={{ width: "100%" }}
                placeholder="as Bricks spells it"
                value={editing.bricksAlias ?? ""}
                onChange={(e) => setEditing({ ...editing, bricksAlias: e.target.value })}
              />
            </div>
          </div>

          <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
            <label style={{ textTransform: "none", letterSpacing: 0, marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={editing.excluded}
                onChange={(e) => setEditing({ ...editing, excluded: e.target.checked })}
              />{" "}
              Excluded from all attendance rules
            </label>
            <label style={{ textTransform: "none", letterSpacing: 0, marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />{" "}
              Still with the company
            </label>
            <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              <button className="ghost" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
              <button
                onClick={() => save(editing)}
                disabled={busy || !editing.employmentNumber.trim() || !editing.nameEn.trim()}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2>{rows.filter((r) => r.active).length} on the roster</h2>
          <button className="subtle" onClick={() => setEditing({ ...BLANK })}>
            Add someone
          </button>
        </div>
        <table style={{ marginTop: 18 }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Role</th>
              <th>Tracking</th>
              <th>Bricks name</th>
              <th>ZenHR</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employmentNumber} style={row.active ? undefined : { opacity: 0.5 }}>
                <td>{row.employmentNumber}</td>
                <td>
                  {row.nameEn}
                  {row.excluded && (
                    <span className="chip" style={{ marginLeft: 8 }}>
                      excluded
                    </span>
                  )}
                </td>
                <td className="muted">{row.role}</td>
                <td>
                  <span className="chip calm">{TRACKING_LABEL[row.tracking]}</span>
                </td>
                <td className="muted">{row.bricksAlias ?? "—"}</td>
                <td className="muted tiny">
                  {row.zenhrEmployeeId ? `#${row.zenhrEmployeeId}` : "unmatched"}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button className="ghost tiny" onClick={() => setEditing({ ...row })}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
