"use client";

import { useEffect, useState } from "react";

type Bucket = "EMERGENCY" | "ANNUAL" | "UNPAID" | "BUSINESS_MISSION" | "NONE";

interface LeaveType {
  bucket: Bucket;
  zenhrTimeoffId: number | null;
  zenhrName: string | null;
  entitlementDays: number;
}

interface Reason {
  code: string;
  label: string;
  color: string;
  defaultBucket: Bucket;
  allowsToggle: boolean;
  defaultDays: number;
  hoursEditable: boolean;
  active: boolean;
  sortOrder: number;
}

interface Payload {
  leaveTypes: LeaveType[];
  reasons: Reason[];
  zenhrTimeoffs: { id: number; name: string }[];
  warning: string | null;
  error?: string;
}

const BUCKET_LABEL: Record<Bucket, string> = {
  EMERGENCY: "Emergency leave",
  ANNUAL: "Annual leave",
  UNPAID: "Unpaid leave",
  BUSINESS_MISSION: "Business mission",
  NONE: "No deduction",
};

const WRITABLE_BUCKETS: Bucket[] = ["EMERGENCY", "ANNUAL", "UNPAID", "BUSINESS_MISSION"];

export function SettingsEditor() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((json: Payload) => (json.error ? setError(json.error) : setData(json)))
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <div className="notice alert">{error}</div>;
  if (!data) return <div className="card muted">Loading…</div>;

  const leaveTypes = WRITABLE_BUCKETS.map(
    (bucket) =>
      data.leaveTypes.find((lt) => lt.bucket === bucket) ?? {
        bucket,
        zenhrTimeoffId: null,
        zenhrName: null,
        entitlementDays: 0,
      }
  );

  function patchLeaveType(bucket: Bucket, patch: Partial<LeaveType>) {
    setData({
      ...data!,
      leaveTypes: leaveTypes.map((lt) => (lt.bucket === bucket ? { ...lt, ...patch } : lt)),
    });
    setSaved(false);
  }

  function patchReason(code: string, patch: Partial<Reason>) {
    setData({
      ...data!,
      reasons: data!.reasons.map((r) => (r.code === code ? { ...r, ...patch } : r)),
    });
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaveTypes, reasons: data!.reasons }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not save");
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {data.warning && <div className="notice warn">{data.warning}</div>}
      {saved && <div className="notice calm">Saved.</div>}

      <section className="card">
        <h2>Leave types</h2>
        <p className="tiny muted">
          The Apply button writes a time-off transaction against one of these ZenHR leave types.
          ZenHR&apos;s API exposes no balance endpoint, so a balance is shown as entitlement minus
          the approved transactions of that type this year — keep the entitlement here current.
        </p>
        <table style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Bucket</th>
              <th>ZenHR leave type</th>
              <th>Entitlement (days/year)</th>
            </tr>
          </thead>
          <tbody>
            {leaveTypes.map((lt) => (
              <tr key={lt.bucket}>
                <td>{BUCKET_LABEL[lt.bucket]}</td>
                <td>
                  {data.zenhrTimeoffs.length ? (
                    <select
                      value={lt.zenhrTimeoffId ?? ""}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        patchLeaveType(lt.bucket, {
                          zenhrTimeoffId: id,
                          zenhrName: data.zenhrTimeoffs.find((t) => t.id === id)?.name ?? null,
                        });
                      }}
                    >
                      <option value="">— not mapped —</option>
                      {data.zenhrTimeoffs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} (#{t.id})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      placeholder="timeoff id"
                      style={{ width: 130 }}
                      value={lt.zenhrTimeoffId ?? ""}
                      onChange={(e) =>
                        patchLeaveType(lt.bucket, {
                          zenhrTimeoffId: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    />
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    style={{ width: 90 }}
                    value={lt.entitlementDays}
                    onChange={(e) =>
                      patchLeaveType(lt.bucket, { entitlementDays: Number(e.target.value) })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Reasons</h2>
        <p className="tiny muted">
          Colour-coded and editable. A reason set to “no deduction” records the day as reviewed and
          writes nothing to ZenHR.
        </p>
        <table style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Reason</th>
              <th>Colour</th>
              <th>Charges to</th>
              <th>Days</th>
              <th>Hourly</th>
              <th>Toggle</th>
              <th>In use</th>
            </tr>
          </thead>
          <tbody>
            {data.reasons.map((reason) => (
              <tr key={reason.code}>
                <td>
                  <input
                    value={reason.label}
                    style={{ width: 170 }}
                    onChange={(e) => patchReason(reason.code, { label: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="color"
                    value={reason.color}
                    style={{ width: 52, padding: 2 }}
                    onChange={(e) => patchReason(reason.code, { color: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={reason.defaultBucket}
                    onChange={(e) =>
                      patchReason(reason.code, { defaultBucket: e.target.value as Bucket })
                    }
                  >
                    {(["NONE", ...WRITABLE_BUCKETS] as Bucket[]).map((b) => (
                      <option key={b} value={b}>
                        {BUCKET_LABEL[b]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    step={0.5}
                    style={{ width: 76 }}
                    value={reason.defaultDays}
                    onChange={(e) =>
                      patchReason(reason.code, { defaultDays: Number(e.target.value) })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={reason.hoursEditable}
                    onChange={(e) => patchReason(reason.code, { hoursEditable: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={reason.allowsToggle}
                    onChange={(e) => patchReason(reason.code, { allowsToggle: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={reason.active}
                    onChange={(e) => patchReason(reason.code, { active: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <button onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
    </>
  );
}
