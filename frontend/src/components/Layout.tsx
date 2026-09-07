import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to: "/", label: "Directory" },
  { to: "/reports", label: "Reports" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-paper/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="font-semibold tracking-tight text-lg">
              Full Stock <span className="text-muted font-normal">HR</span>
            </Link>
            <nav className="flex items-center gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    location.pathname === item.to
                      ? "bg-ink text-paper"
                      : "text-muted hover:text-ink hover:bg-black/5"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              {user?.role === "ADMIN" && (
                <Link
                  to="/settings"
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    location.pathname === "/settings"
                      ? "bg-ink text-paper"
                      : "text-muted hover:text-ink hover:bg-black/5"
                  }`}
                >
                  Settings
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-right">
              <div className="font-medium">{user?.name}</div>
              <div className="text-xs text-muted">{user?.role === "ADMIN" ? "Admin" : "View only"}</div>
            </div>
            <button
              onClick={() => logout()}
              className="text-sm text-muted hover:text-ink px-3 py-1.5 rounded-md hover:bg-black/5 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
