import { Nav } from "../../nav";
import { isConnected } from "@/lib/zenhr";
import { isBricksConfigured } from "@/lib/bricks";

export const dynamic = "force-dynamic";

export default async function ConnectZenhrPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string }>;
}) {
  const { connected } = await searchParams;
  let zenhrConnected = false;
  let error: string | null = null;
  try {
    zenhrConnected = await isConnected();
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <main className="shell">
      <Nav current="admin" />
      <p className="lede">
        The ZenHR integration is authorised once, here. After that the tool refreshes its own token
        and no one needs to come back to this page.
      </p>

      {connected === "1" && <div className="notice calm">ZenHR is connected.</div>}
      {error && <div className="notice alert">{error}</div>}

      <section className="card">
        <h2>ZenHR</h2>
        <p className="muted">
          {zenhrConnected
            ? "Connected. Re-authorising is harmless if the token was revoked on ZenHR's side."
            : "Not connected yet — the tool cannot read attendance or write deductions until it is."}
        </p>
        <a href="/api/auth/zenhr/connect">
          <button>{zenhrConnected ? "Re-authorise ZenHR" : "Connect ZenHR"}</button>
        </a>
      </section>

      <section className="card">
        <h2>Bricks</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {isBricksConfigured()
            ? "API key is set. Visit counts will be pulled alongside each range."
            : "BRICKS_API_KEY is not set, so delivery-agent visit counts will be blank. Set it as an environment variable on the project."}
        </p>
      </section>
    </main>
  );
}
