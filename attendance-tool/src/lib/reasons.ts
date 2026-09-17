// The standing reason list. Colour-coded, editable in-tool (/settings);
// this is the seed. `bucket` decides what the Apply button writes to ZenHR -
// NONE means the row is recorded as reviewed but creates no transaction.

export interface ReasonSeed {
  code: string;
  label: string;
  color: string;
  defaultBucket: "EMERGENCY" | "ANNUAL" | "UNPAID" | "BUSINESS_MISSION" | "NONE";
  allowsToggle: boolean;
  defaultDays: number;
  hoursEditable: boolean;
  sortOrder: number;
}

export const REASON_SEED: ReasonSeed[] = [
  {
    code: "FULL_DAY_ABSENCE",
    label: "Full-day absence",
    color: "#d4574a",
    // Charged to emergency leave, falling to annual when emergency is
    // exhausted - hence the per-row Emergency/Annual toggle.
    defaultBucket: "EMERGENCY",
    allowsToggle: true,
    defaultDays: 1,
    hoursEditable: false,
    sortOrder: 10,
  },
  {
    code: "MISSING_CHECKOUT",
    label: "Missing checkout",
    color: "#d89b3c",
    defaultBucket: "EMERGENCY",
    allowsToggle: true,
    defaultDays: 0.5,
    hoursEditable: false,
    sortOrder: 20,
  },
  {
    code: "PERSONAL_EXCUSE",
    label: "Personal excuse",
    color: "#c9803f",
    defaultBucket: "EMERGENCY",
    allowsToggle: true,
    defaultDays: 1,
    hoursEditable: true,
    sortOrder: 30,
  },
  {
    code: "BUSINESS_MISSION",
    label: "Business mission",
    color: "#4a8fb0",
    // No deduction: already logged in ZenHR. Hours stay editable per row
    // because a mission is not a fixed 9-5.
    defaultBucket: "NONE",
    allowsToggle: false,
    defaultDays: 0,
    hoursEditable: true,
    sortOrder: 40,
  },
  {
    code: "DAY_OFF",
    label: "Day off",
    color: "#8a93a6",
    defaultBucket: "NONE",
    allowsToggle: false,
    defaultDays: 0,
    hoursEditable: false,
    sortOrder: 50,
  },
  {
    code: "FUNERAL",
    label: "Funeral / bereavement",
    color: "#6d6a8a",
    defaultBucket: "NONE",
    allowsToggle: false,
    defaultDays: 0,
    hoursEditable: false,
    sortOrder: 60,
  },
  {
    code: "UNPAID_LEAVE",
    label: "Unpaid leave",
    color: "#7a6a5d",
    defaultBucket: "UNPAID",
    allowsToggle: false,
    defaultDays: 1,
    hoursEditable: true,
    sortOrder: 70,
  },
  {
    code: "SYSTEM_ISSUE",
    label: "System issue",
    color: "#5f8f7a",
    defaultBucket: "NONE",
    allowsToggle: false,
    defaultDays: 0,
    hoursEditable: false,
    sortOrder: 80,
  },
  {
    code: "NOT_ONBOARDED",
    label: "Not onboarded",
    color: "#9aa0ac",
    defaultBucket: "NONE",
    allowsToggle: false,
    defaultDays: 0,
    hoursEditable: false,
    sortOrder: 90,
  },
  {
    code: "MANUAL_REVIEW",
    label: "Manual review",
    color: "#b07fa8",
    defaultBucket: "NONE",
    allowsToggle: false,
    defaultDays: 0,
    hoursEditable: false,
    sortOrder: 100,
  },
];

// Hourly leave converts at 8 hours = 1 day.
export const HOURS_PER_LEAVE_DAY = 8;

export function hoursToDays(hours: number): number {
  return Math.round((hours / HOURS_PER_LEAVE_DAY) * 100) / 100;
}

// The four buckets, and the ZenHR leave-type names we try to match them to
// when resolving GET /timeoffs into timeoff ids. Anything unmatched is set
// by hand at /settings.
export const BUCKET_NAME_HINTS: Record<string, string[]> = {
  EMERGENCY: ["emergency", "casual", "طارئة", "عارضة"],
  ANNUAL: ["annual", "سنوية"],
  UNPAID: ["unpaid", "بدون اجر", "بدون أجر"],
  BUSINESS_MISSION: ["business mission", "mission", "مأمورية", "مهمة عمل"],
};
