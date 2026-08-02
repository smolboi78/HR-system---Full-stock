"use client";

export function SignOutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/logout", { method: "POST" });
        window.location.href = "/login";
      }}
      style={{ background: "transparent", color: "white", border: "1px solid #555" }}
    >
      Sign out
    </button>
  );
}
