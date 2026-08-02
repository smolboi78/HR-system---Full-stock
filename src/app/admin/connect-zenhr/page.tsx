import { prisma } from "@/lib/db";

export default async function ConnectZenhrPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  const token = await prisma.zenhrOAuthToken.findUnique({ where: { id: "default" } });

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 22 }}>Connect ZenHR</h1>
      <p style={{ color: "#555" }}>
        This is a one-time step. Whoever is the Global Admin on ZenHR should click the button
        below and log in to authorize this dashboard to read attendance and employee data.
      </p>

      {params.connected && (
        <p style={{ color: "#15803d", fontWeight: "bold" }}>ZenHR connected successfully.</p>
      )}
      {params.error && <p style={{ color: "crimson" }}>Error: {params.error}</p>}

      <p>
        Status:{" "}
        {token ? (
          <strong style={{ color: "#15803d" }}>
            Connected (token refreshes automatically, last updated{" "}
            {token.updatedAt.toISOString()})
          </strong>
        ) : (
          <strong style={{ color: "#b91c1c" }}>Not connected</strong>
        )}
      </p>

      <a href="/api/auth/zenhr/connect">
        <button style={{ padding: "10px 16px" }}>
          {token ? "Reconnect ZenHR" : "Connect ZenHR"}
        </button>
      </a>
    </div>
  );
}
