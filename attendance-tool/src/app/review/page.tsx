import { Nav } from "../nav";
import { ReviewWorkspace } from "./workspace";

// Default window: the last seven days up to yesterday, which is the usual
// daily/weekly reconciliation range. Both ends stay editable.
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 6);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function ReviewPage() {
  const range = defaultRange();
  return (
    <main className="shell">
      <Nav current="review" />
      <p className="lede">
        Pull the range from ZenHR and Bricks, let the standing rules settle the obvious days, then
        work through only what they could not resolve.
      </p>
      <ReviewWorkspace defaultFrom={range.from} defaultTo={range.to} />
    </main>
  );
}
