"use client";

import { useState } from "react";

interface Result {
  ok: boolean;
  mode: string;
  message: string;
  scopes?: string[];
  company?: string | number;
  canWriteTimeoff?: boolean;
}

export function ConnectionTester() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            const res = await fetch("/api/zenhr/test");
            // The endpoint can die without a body - a timeout, or the
            // function being killed. Reading text first turns that into
            // something a person can act on rather than a parser error.
            const raw = await res.text();
            if (!raw.trim()) {
              setResult({
                ok: false,
                mode: "unknown",
                message:
                  `The check returned nothing (HTTP ${res.status}). That usually means it ran out ` +
                  `of time waiting on ZenHR. Try again; if it keeps happening, ZenHR is not ` +
                  `answering at the configured address.`,
              });
              return;
            }
            try {
              setResult(JSON.parse(raw) as Result);
            } catch {
              setResult({
                ok: false,
                mode: "unknown",
                message: `Unexpected reply (HTTP ${res.status}): ${raw.slice(0, 300)}`,
              });
            }
          } catch (err) {
            setResult({ ok: false, mode: "unknown", message: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
      >
        {busy ? "Asking ZenHR…" : "Test connection"}
      </button>

      {result && (
        <div className={`notice ${result.ok ? "calm" : "alert"}`} style={{ marginTop: 16 }}>
          <strong>{result.ok ? "ZenHR answered" : "ZenHR refused"}</strong>
          <div style={{ marginTop: 6 }}>{result.message}</div>
          {result.ok && (
            <div style={{ marginTop: 10 }}>
              {result.canWriteTimeoff === true && (
                <span className="chip calm">Can write time off — deductions will apply</span>
              )}
              {result.canWriteTimeoff === false && (
                <span className="chip alert">
                  No time-off write permission — reads work, Apply will fail
                </span>
              )}
              {result.canWriteTimeoff === undefined && (
                <span className="chip warn">
                  Reads confirmed. Write access is whatever was ticked on the key — the first Apply
                  will confirm it
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
