// Egypt national public holidays, 2026.
//
// Fixed-date holidays are confirmed by the Egyptian government's official
// holiday calendar. Islamic (Hijri) holidays - Eid al-Fitr, Arafat Day,
// Eid al-Adha, Islamic New Year, Mawlid al-Nabi - depend on moon sighting
// and are estimates until confirmed closer to the date by Dar al-Ifta; they
// can shift by 1-2 days. Update this list each year.
export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

export const EGYPT_HOLIDAYS_2026: Holiday[] = [
  { date: "2026-01-07", name: "Coptic Christmas" },
  { date: "2026-01-25", name: "January 25 Revolution / Police Day" },
  { date: "2026-03-20", name: "Eid al-Fitr (Day 1)" },
  { date: "2026-03-21", name: "Eid al-Fitr (Day 2)" },
  { date: "2026-03-22", name: "Eid al-Fitr (Day 3)" },
  { date: "2026-04-12", name: "Coptic Easter Sunday" },
  { date: "2026-04-13", name: "Sham El Nessim" },
  { date: "2026-04-25", name: "Sinai Liberation Day" },
  { date: "2026-05-01", name: "Labour Day" },
  { date: "2026-05-26", name: "Arafat Day" },
  { date: "2026-05-27", name: "Eid al-Adha (Day 1)" },
  { date: "2026-05-28", name: "Eid al-Adha (Day 2)" },
  { date: "2026-05-29", name: "Eid al-Adha (Day 3)" },
  { date: "2026-06-17", name: "Islamic New Year" },
  { date: "2026-06-30", name: "June 30 Revolution Day" },
  { date: "2026-07-23", name: "July 23 Revolution Day" },
  { date: "2026-08-26", name: "Prophet Muhammad's Birthday (Mawlid al-Nabi)" },
  { date: "2026-10-06", name: "Armed Forces Day" },
];

const EGYPT_HOLIDAY_DATES_2026 = new Set(EGYPT_HOLIDAYS_2026.map((h) => h.date));

export function isEgyptHoliday(date: Date): boolean {
  return EGYPT_HOLIDAY_DATES_2026.has(date.toISOString().slice(0, 10));
}
