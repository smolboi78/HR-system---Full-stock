"use client";

import { useCallback, useMemo, useState } from "react";
import type { ApplyResult, Bucket, ReconcileResponse, Reason, Row } from "./types";
import { rowKey } from "./types";
import { DetailPane } from "./detail-pane";

// A reviewer's working copy of a row: the reason they picked, which balance
// it draws from, hours where the reason is hourly, and a note. Seeded from
// the engine's suggestion and editable until Apply.
export interface Draft {
  reasonCode: string | null;
  bucket: Bucket | null;
  hours: number | null;
  note: string;
}

export function ReviewWorkspace({
  defaultFrom,
  defaultTo,
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReconcileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<ApplyResult[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const applyEnabled = data?.applyEnabled === true;
  const reasonsByCode = useMemo(
    () => new Map((data?.reasons ?? []).map((r) => [r.code, r])),
    [data]
  );

  const pull = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const res = await fetch(`/api/reconcile?from=${from}&to=${to}`);
      const json = (await res.json()) as ReconcileResponse;
      if (!res.ok) throw new Error(json.error || `The pull failed (${res.status})`);
      setData(json);

      // Pre-fill each exception from the standing rules. Where the rules
      // can't say, the reason stays blank rather than guessed.
      const seeded: Record<string, Draft> = {};
      for (const row of json.rows) {
        if (row.state !== "EXCEPTION") continue;
        const reason = row.suggestedReason
          ? json.reasons.find((r) => r.code === row.suggestedReason)
          : undefined;
        seeded[rowKey(row)] = {
          reasonCode: reason?.code ?? null,
          bucket: reason ? defaultBucketFor(reason, json.balances[row.employmentNumber]) : null,
          hours: null,
          note: "",
        };
      }
      setDrafts(seeded);
      setChecked(new Set());
      const firstException = json.rows.find((r) => r.state === "EXCEPTION");
      setSelectedKey(firstException ? rowKey(firstException) : null);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  const exceptions = useMemo(
    () => (data?.rows ?? []).filter((r) => r.state === "EXCEPTION"),
    [data]
  );
  const unmatched = useMemo(
    () => (data?.rows ?? []).filter((r) => r.state === "UNMATCHED"),
    [data]
  );
  const resolved = useMemo(
    () => (data?.rows ?? []).filter((r) => r.state !== "EXCEPTION" && r.state !== "UNMATCHED"),
    [data]
  );
  const appliedKeys = useMemo(
    () => new Set(results.filter((r) => r.ok).map((r) => `${r.employmentNumber}|${r.date}`)),
    [results]
  );
  const queue = useMemo(
    () => exceptions.filter((r) => !appliedKeys.has(rowKey(r))),
    [exceptions, appliedKeys]
  );

  const selected = queue.find((r) => rowKey(r) === selectedKey) ?? queue[0] ?? null;

  const setDraft = useCallback((key: string, patch: Partial<Draft>) => {
    const blank: Draft = { reasonCode: null, bucket: null, hours: null, note: "" };
    setDrafts((prev) => ({ ...prev, [key]: { ...blank, ...prev[key], ...patch } }));
  }, []);

  // Applying advances to the next unresolved row so the queue can be worked
  // straight through without going back to the list.
  const advance = useCallback(
    (justAppliedKeys: string[]) => {
      const done = new Set(justAppliedKeys);
      const next = queue.find((r) => !done.has(rowKey(r)) && rowKey(r) !== selectedKey);
      setSelectedKey(next ? rowKey(next) : null);
    },
    [queue, selectedKey]
  );

  const apply = useCallback(
    async (rows: Row[]) => {
      const payload = rows
        .map((row) => {
          const draft = drafts[rowKey(row)];
          if (!draft?.reasonCode) return null;
          const reason = reasonsByCode.get(draft.reasonCode);
          return {
            employmentNumber: row.employmentNumber,
            date: row.date,
            reasonCode: draft.reasonCode,
            bucket: draft.bucket ?? undefined,
            hours:
              reason?.hoursEditable && draft.hours !== null && draft.hours > 0
                ? draft.hours
                : undefined,
            note: draft.note || undefined,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (!payload.length) {
        setError("Pick a reason first — nothing is applied without one.");
        return;
      }
      setApplying(true);
      setError(null);
      try {
        const res = await fetch("/api/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: payload }),
        });
        const json = (await res.json()) as { results?: ApplyResult[]; error?: string };
        if (!res.ok) throw new Error(json.error || `Apply failed (${res.status})`);
        const fresh = json.results ?? [];
        setResults((prev) => [...prev, ...fresh]);
        setChecked(new Set());
        advance(fresh.filter((r) => r.ok).map((r) => `${r.employmentNumber}|${r.date}`));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setApplying(false);
      }
    },
    [advance, drafts, reasonsByCode]
  );

  const checkedRows = queue.filter((r) => checked.has(rowKey(r)));
  const failures = results.filter((r) => !r.ok);

  return (
    <>
      <section className="card">
        {data && !applyEnabled && (
          <div className="notice calm" style={{ marginBottom: 18 }}>
            Reading only. These are the days with no attendance in ZenHR, no Bricks visit and no
            time off on file — add the time off in ZenHR, then pull again to confirm it clears.
          </div>
        )}
        <div className="row">
          <div>
            <label htmlFor="from">From</label>
            <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="to">To</label>
            <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button onClick={pull} disabled={loading}>
            {loading ? "Pulling…" : "Pull & reconcile"}
          </button>
          {data && (
            <button className="ghost" onClick={() => setShowResolved((v) => !v)}>
              {showResolved ? "Hide resolved days" : `Show ${resolved.length} resolved days`}
            </button>
          )}
        </div>

        {error && <div className="notice alert" style={{ marginTop: 18 }}>{error}</div>}

        {data && (
          <>
            <hr className="divider" />
            <div className="stats">
              <Stat label="Needs review" value={queue.length} />
              <Stat label="Present" value={data.summary.present} />
              <Stat label="On leave" value={data.summary.timeOff} />
              <Stat label="Days off" value={data.summary.daysOff} />
              {data.summary.unmatched > 0 && (
                <Stat label="Unmatched people" value={data.summary.unmatched} />
              )}
              <Stat label="Applied this session" value={appliedKeys.size} />
            </div>
          </>
        )}
      </section>

      {data?.warnings?.length ? (
        <section className="card quiet">
          <h2>Worth knowing</h2>
          <ul className="tiny muted" style={{ margin: "10px 0 0", paddingLeft: 20 }}>
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {unmatched.length ? (
        <section className="card">
          <h2>
            {unmatched.length} {unmatched.length === 1 ? "person" : "people"} could not be checked
          </h2>
          <p className="tiny muted">
            They are on the roster but no ZenHR employee carries their employment number, so none of
            their days in this range were judged either way. Fix the number on the roster and pull
            again — nothing here is chargeable.
          </p>
          <button className="ghost" onClick={() => setShowUnmatched((v) => !v)}>
            {showUnmatched ? "Hide the list" : "Show who"}
          </button>
          <table style={{ marginTop: 14, display: showUnmatched ? "table" : "none" }}>
            <tbody>
              {unmatched.map((row) => (
                <tr key={row.employmentNumber}>
                  <td style={{ width: 70 }}>{row.employmentNumber}</td>
                  <td>{row.nameEn}</td>
                  <td className="muted">{row.role}</td>
                  <td style={{ textAlign: "right" }}>
                    <a href="/roster" className="tiny">
                      Open roster
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {failures.length ? (
        <section className="card">
          <div className="notice alert">
            {failures.length} row{failures.length === 1 ? "" : "s"} did not reach ZenHR.
          </div>
          <table>
            <tbody>
              {failures.map((f) => (
                <tr key={`${f.employmentNumber}|${f.date}`}>
                  <td style={{ width: 90 }}>{f.date}</td>
                  <td style={{ width: 70 }}>{f.employmentNumber}</td>
                  <td className="muted">{f.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {data && (
        <div className="queue">
          <div>
            {applyEnabled && checkedRows.length > 1 && (
              <div className="card" style={{ padding: "16px 18px" }}>
                <div className="tiny muted" style={{ marginBottom: 10 }}>
                  {checkedRows.length} rows selected. Batch apply sends every selected row with the
                  reason it currently shows.
                </div>
                <button onClick={() => apply(checkedRows)} disabled={applying}>
                  {applying ? "Applying…" : `Apply ${checkedRows.length} rows`}
                </button>
              </div>
            )}

            <div className="list">
              {queue.length === 0 ? (
                <div className="empty">
                  Nothing left to review in this range. Every day either resolved on its own or has
                  been applied.
                </div>
              ) : (
                queue.map((row) => {
                  const key = rowKey(row);
                  const draft = drafts[key];
                  const reason = draft?.reasonCode ? reasonsByCode.get(draft.reasonCode) : undefined;
                  return (
                    <button
                      key={key}
                      className={`item${key === rowKey(selected ?? row) && selected ? " selected" : ""}`}
                      onClick={() => setSelectedKey(key)}
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(key)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const next = new Set(checked);
                          if (e.target.checked) next.add(key);
                          else next.delete(key);
                          setChecked(next);
                        }}
                        aria-label={`Select ${row.nameEn} on ${row.date}`}
                      />
                      <span style={{ flex: 1 }}>
                        <span className="who">{row.nameEn}</span>
                        <br />
                        <span className="when">
                          {row.date} · {row.employmentNumber} · {row.detail}
                        </span>
                        <br />
                        {reason ? (
                          <span
                            className="chip"
                            style={{ background: `${reason.color}1f`, color: reason.color, marginTop: 6 }}
                          >
                            {reason.label}
                          </span>
                        ) : (
                          <span className="chip warn" style={{ marginTop: 6 }}>
                            Reason needed
                          </span>
                        )}
                        {row.flags
                          .filter((f) => f.reference)
                          .map((f) => (
                            <span key={f.code} className="chip alert" style={{ marginLeft: 6 }}>
                              {f.label}
                            </span>
                          ))}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div>
            {selected ? (
              <DetailPane
                row={selected}
                reasons={data.reasons}
                balances={data.balances[selected.employmentNumber]}
                draft={
                  drafts[rowKey(selected)] ?? {
                    reasonCode: null,
                    bucket: null,
                    hours: null,
                    note: "",
                  }
                }
                onDraftChange={(patch) => setDraft(rowKey(selected), patch)}
                onApply={() => apply([selected])}
                applying={applying}
                applyEnabled={applyEnabled}
              />
            ) : (
              <div className="card">
                <h2>Queue clear</h2>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {results.length
                    ? `${appliedKeys.size} row${appliedKeys.size === 1 ? "" : "s"} applied to ZenHR in this session.`
                    : "Pick a row on the left to see the day in full."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {data && showResolved && (
        <section className="card">
          <h2>Resolved without review</h2>
          <p className="tiny muted">
            Kept visible so a wrong auto-resolution is still catchable, and not editable here.
          </p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>ID</th>
                <th>Name</th>
                <th>Outcome</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((row) => (
                <tr key={rowKey(row)}>
                  <td>{row.date}</td>
                  <td>{row.employmentNumber}</td>
                  <td>{row.nameEn}</td>
                  <td>
                    <span className="chip calm">{prettyState(row.state)}</span>
                  </td>
                  <td className="muted">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

function prettyState(state: Row["state"]): string {
  switch (state) {
    case "PRESENT":
      return "Present";
    case "TIME_OFF":
      return "On leave";
    case "DAY_OFF":
      return "Day off";
    case "HOLIDAY":
      return "Holiday";
    case "NOT_EMPLOYED":
      return "Not employed";
    case "UNMATCHED":
      return "Unmatched";
    default:
      return state;
  }
}

// Emergency first, annual once the emergency balance can't cover the day.
export function defaultBucketFor(
  reason: Reason,
  balances: { remaining: { emergency: number | null } | null } | undefined
): Bucket {
  if (!reason.allowsToggle) return reason.defaultBucket;
  // Emergency first. Annual is only pre-selected when ZenHR has actually
  // said the emergency balance cannot cover the day.
  const remaining = balances?.remaining?.emergency ?? null;
  return remaining !== null && remaining < reason.defaultDays ? "ANNUAL" : "EMERGENCY";
}
