"use client";

import { useEffect, useState } from "react";
import type { Balances, Bucket, Reason, Row } from "./types";
import type { Draft } from "./workspace";

// One flagged day, in full: who and when, the shift ZenHR has them on, what
// each system saw, the flags, their balances, and the reason to apply.
export function DetailPane({
  row,
  reasons,
  balances,
  draft,
  onDraftChange,
  onApply,
  applying,
}: {
  row: Row;
  reasons: Reason[];
  balances: Balances | undefined;
  draft: Draft;
  onDraftChange: (patch: Partial<Draft>) => void;
  onApply: () => void;
  applying: boolean;
}) {
  // Leave usage is read for this employee when their row is opened. Reading
  // it for everyone during a pull was the slowest thing the tool did, for a
  // figure only ever read one person at a time.
  const [loaded, setLoaded] = useState<Balances | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setLoadingBalance(true);
    fetch(
      `/api/employee/balance?employmentNumber=${encodeURIComponent(row.employmentNumber)}` +
        `&year=${row.date.slice(0, 4)}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json && !json.error) setLoaded(json as Balances);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingBalance(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row.employmentNumber, row.date]);

  const shown = loaded ?? balances;
  const reason = draft.reasonCode ? reasons.find((r) => r.code === draft.reasonCode) : undefined;
  const bucket: Bucket = draft.bucket ?? reason?.defaultBucket ?? "NONE";
  const deducts = Boolean(reason && bucket !== "NONE" && reason.defaultDays > 0);
  const emergencyRemaining = shown?.remaining?.emergency ?? null;
  // Only warn when ZenHR has actually told us the balance. Guessing from an
  // entitlement kept in this tool would be worse than saying nothing.
  const shortOfBalance =
    deducts &&
    bucket === "EMERGENCY" &&
    emergencyRemaining !== null &&
    emergencyRemaining < (reason?.defaultDays ?? 0);

  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2>{row.nameEn}</h2>
          <div className="muted tiny">
            {row.employmentNumber} · {row.role} · {trackingLabel(row.tracking)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 600 }}>{row.date}</div>
          <div className="muted tiny">{row.shiftLabel ?? "No shift assigned in ZenHR"}</div>
        </div>
      </div>

      <div className="facts">
        <Fact k="ZenHR" v={zenhrSummary(row)} />
        {row.tracking !== "HOURS" && (
          <Fact
            k="Bricks visits"
            v={row.bricksVisits === null ? "No data" : String(row.bricksVisits)}
            alert={row.bricksVisits === 0}
          />
        )}
        <Fact k="Time off on file" v={row.timeoffName ?? "None"} />
        <Fact k="What the rules saw" v={row.detail} />
      </div>

      {row.flags.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          {row.flags.map((f) => (
            <span key={f.code} className={`chip ${f.reference ? "alert" : "warn"}`}>
              {f.label}
              {f.reference ? " · reference only" : ""}
            </span>
          ))}
        </div>
      )}

      <hr className="divider" />

      <div className="facts" style={{ marginTop: 0 }}>
        <Fact
          k="Emergency"
          v={
            loadingBalance && !loaded
              ? "Reading from ZenHR…"
              : balanceText(shown?.emergency.usedThisYear, shown?.remaining?.emergency)
          }
        />
        <Fact
          k="Annual"
          v={
            loadingBalance && !loaded
              ? "Reading from ZenHR…"
              : balanceText(shown?.annual.usedThisYear, shown?.remaining?.annual)
          }
        />
        <Fact
          k="Both together"
          v={
            loaded
              ? `${round(loaded.emergency.usedThisYear + loaded.annual.usedThisYear)} days taken this year`
              : loadingBalance
                ? "Reading from ZenHR…"
                : "Unknown"
          }
        />
      </div>
      {loaded?.remaining === null && (
        <p className="tiny muted" style={{ marginTop: 2 }}>
          Days taken come from ZenHR&apos;s own approved transactions. Remaining balance is only
          shown once ZenHR exposes it — check the employee in ZenHR if the balance decides the call.
        </p>
      )}

      <hr className="divider" />

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div style={{ minWidth: 220 }}>
          <label htmlFor="reason">Reason</label>
          <select
            id="reason"
            value={draft.reasonCode ?? ""}
            onChange={(e) => {
              const code = e.target.value || null;
              const picked = code ? reasons.find((r) => r.code === code) : undefined;
              onDraftChange({
                reasonCode: code,
                // Re-seed the toggle from the new reason, preferring
                // emergency while it can still cover the day.
                // Emergency first, as the rules say; it only pre-selects
                // annual when ZenHR has told us emergency cannot cover it.
                bucket: picked
                  ? picked.allowsToggle
                    ? emergencyRemaining !== null && emergencyRemaining < picked.defaultDays
                      ? "ANNUAL"
                      : "EMERGENCY"
                    : picked.defaultBucket
                  : null,
              });
            }}
          >
            <option value="">— pick a reason —</option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {reason?.allowsToggle && (
          <div>
            <label htmlFor="bucket">Charge to</label>
            <select
              id="bucket"
              value={bucket}
              onChange={(e) => onDraftChange({ bucket: e.target.value as Bucket })}
            >
              <option value="EMERGENCY">Emergency leave</option>
              <option value="ANNUAL">Annual leave</option>
            </select>
          </div>
        )}

        {reason?.hoursEditable && (
          <div>
            <label htmlFor="hours">Hours</label>
            <input
              id="hours"
              type="number"
              min={0}
              max={24}
              step={0.5}
              style={{ width: 100 }}
              placeholder="full day"
              value={draft.hours ?? ""}
              onChange={(e) =>
                onDraftChange({ hours: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <label htmlFor="note">Note sent to ZenHR</label>
        <textarea
          id="note"
          value={draft.note}
          placeholder={
            reason ? `${reason.label} — ${row.date} (attendance tool)` : "Situational detail for this row"
          }
          onChange={(e) => onDraftChange({ note: e.target.value })}
        />
      </div>

      {reason && (
        <p className="tiny muted" style={{ marginTop: 6 }}>
          {deducts
            ? `Applying charges ${effectiveDays(reason, draft)} day${
                effectiveDays(reason, draft) === 1 ? "" : "s"
              } to ${bucket.toLowerCase().replace("_", " ")} leave in ZenHR.`
            : "Applying records the reason here and writes nothing to ZenHR."}
          {reason.hoursEditable && " Hourly leave converts at 8 hours to the day."}
        </p>
      )}

      {shortOfBalance && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          ZenHR has this employee down to {emergencyRemaining} days of emergency leave — this would
          take it negative. Switch the charge to annual, or apply it knowing it exceeds the balance.
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}>
        <button onClick={onApply} disabled={applying || !draft.reasonCode}>
          {applying ? "Applying…" : "Apply & next"}
        </button>
        {!draft.reasonCode && <span className="tiny muted">A reason is needed before applying.</span>}
      </div>
    </section>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function balanceText(used: number | undefined, remaining: number | null | undefined): string {
  if (used === undefined) return "Unknown";
  const taken = `${round(used)} days taken this year`;
  return remaining === null || remaining === undefined
    ? taken
    : `${remaining} days left · ${taken}`;
}

function effectiveDays(reason: Reason, draft: Draft): number {
  if (reason.hoursEditable && draft.hours !== null && draft.hours > 0) {
    return Math.round((draft.hours / 8) * 100) / 100;
  }
  return reason.defaultDays;
}

function Fact({ k, v, alert }: { k: string; v: string; alert?: boolean }) {
  return (
    <div className="fact">
      <div className="k">{k}</div>
      <div className="v" style={alert ? { color: "var(--alert)" } : undefined}>
        {v}
      </div>
    </div>
  );
}

function trackingLabel(tracking: Row["tracking"]): string {
  switch (tracking) {
    case "HOURS":
      return "hours tracked";
    case "PRESENCE":
      return "presence only";
    case "DELIVERY":
      return "delivery agent";
  }
}

function time(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(11, 16);
}

function zenhrSummary(row: Row): string {
  const entry = time(row.zenhrEntry);
  const exit = time(row.zenhrExit);
  if (!entry && !exit) return "No attendance record";
  if (entry && !exit) return `In ${entry}, no checkout`;
  return `${entry} – ${exit}${row.workedHours !== null ? ` (${row.workedHours}h)` : ""}`;
}
