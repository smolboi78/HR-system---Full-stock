// The standing roster, exactly as handed over from the ZenHR org export
// dated 2026-09-17. Seeded into the RosterEmployee table on first boot and
// editable in-tool afterwards - this file is the starting point, not the
// live source of truth.
//
// Kareem Sherif (previously ID 104) has left the company and is
// deliberately absent, along with any alias for him.

export type Tracking = "HOURS" | "PRESENCE" | "DELIVERY";

export interface RosterSeedRow {
  employmentNumber: string;
  nameEn: string;
  role: string;
  tracking: Tracking;
  excluded?: boolean;
  bricksAlias?: string;
}

// Job role -> tracking method.
//   HOURS    - management & warehouse; duration from ZenHR matters.
//   PRESENCE - sales, collectors, support; present in either system is enough.
//   DELIVERY - ZenHR hours are the record, Bricks visits a reference signal.
export const ROLE_TRACKING: Record<string, Tracking> = {
  "Managing Director": "HOURS",
  "Supply Chain Manager": "HOURS",
  "Finance Manager": "HOURS",
  "Warehouse Supervisor": "HOURS",
  "Logistics Supervisor": "HOURS",
  Accountant: "HOURS",
  "Purchasing Manager": "HOURS",
  "Commercial Director": "HOURS",
  "HR Executive": "HOURS",
  "Office Boy/Girl": "HOURS",
  "HR Consultant": "HOURS",
  "Co-Founder & Executive Board Member": "HOURS",
  "Key Account Manager": "PRESENCE",
  "Senior Account Manager": "PRESENCE",
  "Account Manager": "PRESENCE",
  "Head of Sales": "PRESENCE",
  Collector: "PRESENCE",
  "Sales Support": "PRESENCE",
  "Delivery Agent": "DELIVERY",
};

// Excluded from all attendance rules: no rows, no flags, no deductions.
export const EXCLUDED_EMPLOYMENT_NUMBERS = ["101", "103", "210"];

// Employee 211 (Sales Support) files a Business Mission in ZenHR whenever
// he is out of the office, so ZenHR is the source of truth for his days out
// and an uncovered gap for him is treated as a mission to confirm rather
// than a straight absence.
export const BUSINESS_MISSION_EMPLOYEE = "211";

const RAW: [string, string, string, string?][] = [
  ["101", "Ahmed Abd Elsattar Hafez Mohamed", "Managing Director"],
  ["102", "Ahmed Saied Mohamed Ahmed", "Supply Chain Manager"],
  ["103", "Mohamed Reda Mohamed Abd Allah", "HR Consultant"],
  ["105", "Ahmed Abd Elazim Hasan Badran", "Finance Manager"],
  ["108", "Taher Abed Ahmed Mohamed", "Warehouse Supervisor"],
  ["110", "Abd Elrahman Ali Mohamed Ali", "Warehouse Supervisor"],
  ["112", "Mohamed Karam Mansour Othman", "Logistics Supervisor"],
  ["113", "Mahmoud Salah Elsayed Abd Elmotagally", "Warehouse Supervisor"],
  ["115", "Karim Samy Fathy Ahmed", "Collector", "Kareem Elsobky"],
  ["119", "Mohamed Abd Elrazek Ahmed Mohamed", "Senior Account Manager", "Mohamed Abdelrazek"],
  ["124", "Mohamed Shawky Abd Elnaeem Saber", "Accountant"],
  ["126", "Alaa Mamdouh Mohamed Hussin", "Purchasing Manager"],
  ["127", "Karim Taher Mohamed Mohamed", "Collector", "Kareim Helmy"],
  ["130", "Amr Abd Elkader Abd ElaZim Abd Elfataah", "Delivery Agent", "عمرو عبد القادر"],
  ["135", "Abd Elrahman Amgad Abd elsallam Elbannwy", "Account Manager", "Amgad"],
  ["136", "Amr Mostafa Ismael Hasan", "Senior Account Manager", "Amr Mostafa"],
  ["137", "Hossam Mosad Galal Badwy", "Delivery Agent", "حسام مسعد بدوي"],
  ["139", "Hany Mohamed Yahia Hussin", "Commercial Director"],
  ["140", "Mahmoud Ibrahim Ibrahim Ali", "Delivery Agent", "محمود ابراهيم علي"],
  ["204", "Nesma Nehad Abd Elaziz Shalaby", "HR Executive"],
  ["205", "Safaa Sabry Abd Elaziz Mohamed", "Account Manager", "Safaa Sabry"],
  ["206", "Mona Mohamed Abd Elaziz Mohamed", "Account Manager"],
  ["207", "Mohamed Mohsen Abd Elaziz khaled", "Head of Sales"],
  ["208", "Nora Saber Hassan Abd Elaty", "Office Boy/Girl"],
  ["209", "Mohamed Sayed Abd Elfadieel Abd Ellatief", "Accountant"],
  ["210", "Hesham Hamouda", "Co-Founder & Executive Board Member"],
  ["211", "Ramadan Mohamed Abdlaziz Mohamed", "Sales Support"],
  ["212", "Abduallah Ibrahim Habashi", "Collector", "Abdullah Ibrahim Habashi"],
  ["213", "Ibrahim Abduallah Farag", "Delivery Agent", "ابراهيم عبدالله فراج"],
  ["214", "Ali Ayman Ali Sayed", "Delivery Agent", "علي أيمن علي سيد"],
  ["215", "Ahmed Ibrahim Ahmed Mousa", "Delivery Agent", "أحمد ابراهيم موسى"],
];

export const ROSTER_SEED: RosterSeedRow[] = RAW.map(([employmentNumber, nameEn, role, alias]) => ({
  employmentNumber,
  nameEn,
  role,
  tracking: ROLE_TRACKING[role] ?? "PRESENCE",
  excluded: EXCLUDED_EMPLOYMENT_NUMBERS.includes(employmentNumber),
  bricksAlias: alias,
}));
