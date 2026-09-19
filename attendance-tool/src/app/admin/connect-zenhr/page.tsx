import { Nav } from "../../nav";
import { authMode } from "@/lib/zenhr";
import { isBricksConfigured } from "@/lib/bricks";
import { ConnectionTester } from "./tester";

export const dynamic = "force-dynamic";

const MODE_COPY: Record<string, { title: string; body: string }> = {
  API_KEY: {
    title: "Using an API key",
    body: "ZENHR_API_KEY and ZENHR_API_SECRET are set, so the tool authenticates with the key created under Integration Setup → API Keys. What it may do is decided by the Read / Write / Update ticks on that key. No browser step is involved.",
  },
  STATIC_TOKEN: {
    title: "Using a supplied access token",
    body: "ZENHR_ACCESS_TOKEN is set and sent as-is. Simplest to set up, but ZenHR access tokens expire - add ZENHR_REFRESH_TOKEN so the tool can renew itself.",
  },
  REFRESH_TOKEN: {
    title: "Using a refresh token",
    body: "ZENHR_REFRESH_TOKEN is set, taken from ZenHR's Manage Tokens screen. The tool exchanges it for access tokens on its own, indefinitely, with no browser step.",
  },
  OAUTH_REDIRECT: {
    title: "Using the one-time browser authorisation",
    body: "No key or token is configured, so the tool falls back to authorising once through ZenHR's consent screen and refreshing itself afterwards. Set ZENHR_API_KEY and ZENHR_API_SECRET instead if you would rather avoid the redirect entirely.",
  },
};

export default async function ConnectZenhrPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string }>;
}) {
  const { connected } = await searchParams;
  const mode = authMode();
  const copy = MODE_COPY[mode];

  return (
    <main className="shell">
      <Nav current="admin" />
      <p className="lede">
        How this tool authenticates to ZenHR, and what ZenHR says it is allowed to do.
      </p>

      {connected === "1" && <div className="notice calm">ZenHR authorisation completed.</div>}

      <section className="card">
        <h2>{copy.title}</h2>
        <p className="muted">{copy.body}</p>

        <hr className="divider" />

        <h3>Check what the credential can actually do</h3>
        <p className="tiny muted">
          Asks ZenHR directly and reports the permissions it hands back. Applying a deduction needs
          time-off write; everything else the tool does is a read.
        </p>
        <ConnectionTester />

        {mode === "OAUTH_REDIRECT" && (
          <>
            <hr className="divider" />
            <p className="tiny muted">
              Only needed while no key or token is configured:
            </p>
            <a href="/api/auth/zenhr/connect">
              <button className="ghost">Authorise through ZenHR</button>
            </a>
          </>
        )}
      </section>

      <section className="card">
        <h2>Bricks</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {isBricksConfigured()
            ? "API key is set. Visit counts will be pulled alongside each range."
            : "BRICKS_API_KEY is not set, so delivery-agent visit counts will be blank."}
        </p>
      </section>
    </main>
  );
}
