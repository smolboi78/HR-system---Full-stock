import Link from "next/link";
import { SignOut } from "./sign-out";

export function Nav({ current }: { current: "review" | "roster" | "settings" | "admin" }) {
  const items = [
    { href: "/review", key: "review", label: "Review" },
    { href: "/roster", key: "roster", label: "Roster" },
    { href: "/settings", key: "settings", label: "Settings" },
    { href: "/admin/connect-zenhr", key: "admin", label: "ZenHR connection" },
  ] as const;

  return (
    <div className="topbar">
      <h1>Attendance &amp; deductions</h1>
      <nav className="nav">
        {items.map((item) => (
          <Link key={item.key} href={item.href} className={item.key === current ? "active" : ""}>
            {item.label}
          </Link>
        ))}
        <SignOut />
      </nav>
    </div>
  );
}
