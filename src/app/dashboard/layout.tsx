import Link from "next/link";
import { getSession } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <div style={{ fontFamily: "sans-serif" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 24px",
          background: "#111827",
          color: "white",
        }}
      >
        <nav style={{ display: "flex", gap: 20 }}>
          <Link href="/dashboard" style={{ color: "white" }}>
            Attendance
          </Link>
          <Link href="/reports" style={{ color: "white" }}>
            Reports
          </Link>
          {session.user?.role === "ADMIN" && (
            <Link href="/admin/connect-zenhr" style={{ color: "white" }}>
              Admin
            </Link>
          )}
        </nav>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>{session.user?.name}</span>
          <SignOutButton />
        </div>
      </header>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
