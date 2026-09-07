export interface Period {
  start: string; // YYYY-MM-DD
  end: string;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function lastNDays(n: number): Period {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - n);
  return { start: iso(start), end: iso(end) };
}

export function currentMonth(): Period {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: iso(start), end: iso(now) };
}

export function previousMonth(): Period {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: iso(start), end: iso(end) };
}

export const PERIOD_PRESETS = [
  { label: "Last 30 days", get: () => lastNDays(30) },
  { label: "Last 7 days", get: () => lastNDays(7) },
  { label: "This month", get: () => currentMonth() },
  { label: "Last month", get: () => previousMonth() },
  { label: "Last 90 days", get: () => lastNDays(90) },
];
