// All attendance dates are handled as plain YYYY-MM-DD strings in the
// branch's local sense of a day. Doing the arithmetic in UTC keeps a date
// from sliding a day when the server runs outside Africa/Cairo.

export type DateStr = string; // YYYY-MM-DD

export function toDateStr(d: Date): DateStr {
  return d.toISOString().slice(0, 10);
}

export function parseDateStr(s: DateStr): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function eachDateStr(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  const cur = parseDateStr(from);
  const end = parseDateStr(to);
  while (cur <= end) {
    out.push(toDateStr(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// 0 = Sunday, matching Date#getUTCDay and the roster's daysOff column.
export function weekday(date: DateStr): number {
  return parseDateStr(date).getUTCDay();
}

export function isFuture(date: DateStr, today: DateStr = toDateStr(new Date())): boolean {
  return date > today;
}

// Egypt national public holidays. Fixed-date holidays come from the
// government calendar; the Hijri ones (Eid al-Fitr, Arafat, Eid al-Adha,
// Islamic New Year, Mawlid) depend on moon sighting and can move a day or
// two, so they stay editable here and need a refresh each year.
export const EGYPT_HOLIDAYS: Record<DateStr, string> = {
  "2026-01-07": "Coptic Christmas",
  "2026-01-25": "January 25 Revolution / Police Day",
  "2026-03-20": "Eid al-Fitr (Day 1)",
  "2026-03-21": "Eid al-Fitr (Day 2)",
  "2026-03-22": "Eid al-Fitr (Day 3)",
  "2026-04-12": "Coptic Easter Sunday",
  "2026-04-13": "Sham El Nessim",
  "2026-04-25": "Sinai Liberation Day",
  "2026-05-01": "Labour Day",
  "2026-05-26": "Arafat Day",
  "2026-05-27": "Eid al-Adha (Day 1)",
  "2026-05-28": "Eid al-Adha (Day 2)",
  "2026-05-29": "Eid al-Adha (Day 3)",
  "2026-06-17": "Islamic New Year",
  "2026-06-30": "June 30 Revolution Day",
  "2026-07-23": "July 23 Revolution Day",
  "2026-08-26": "Prophet Muhammad's Birthday",
  "2026-10-06": "Armed Forces Day",
};

export function holidayName(date: DateStr): string | null {
  return EGYPT_HOLIDAYS[date] ?? null;
}
