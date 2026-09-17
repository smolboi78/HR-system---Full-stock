"use client";

import { useRouter } from "next/navigation";

export function SignOut() {
  const router = useRouter();
  return (
    <a
      href="/login"
      style={{ color: "var(--ink-faint)", fontSize: "0.9rem" }}
      onClick={async (e) => {
        e.preventDefault();
        await fetch("/api/logout", { method: "POST" });
        router.push("/login");
      }}
    >
      Sign out
    </a>
  );
}
