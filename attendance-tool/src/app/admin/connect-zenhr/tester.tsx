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
            setResult((await res.json()) as Result);
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
              {result.canWriteTimeoff ? (
                <span className="chip calm">Can write time off — deductions will apply</span>
              ) : (
                <span className="chip alert">
                  No time-off write permission — reads work, Apply will fail
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
