import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="shell" style={{ maxWidth: 440, paddingTop: 96 }}>
      <h1>Attendance &amp; deductions</h1>
      <p className="lede">Full Stock, internal. Sign in to pull the range and apply deductions.</p>
      <div className="card">
        {/* The form reads the ?next= parameter, so it renders on the
            client inside a boundary rather than being prerendered. */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
