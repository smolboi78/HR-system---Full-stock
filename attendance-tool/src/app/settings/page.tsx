import { Nav } from "../nav";
import { SettingsEditor } from "./editor";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="shell">
      <Nav current="settings" />
      <p className="lede">
        Which ZenHR leave type each bucket writes to, what the yearly entitlement is, and the
        standing reason list with its colours.
      </p>
      <SettingsEditor />
    </main>
  );
}
