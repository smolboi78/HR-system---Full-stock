export interface Flag {
  code: string;
  label: string;
  reference: boolean;
}

export interface Row {
  employmentNumber: string;
  nameEn: string;
  role: string;
  tracking: "HOURS" | "PRESENCE" | "DELIVERY";
  date: string;
  state: "PRESENT" | "TIME_OFF" | "DAY_OFF" | "HOLIDAY" | "NOT_EMPLOYED" | "UNMATCHED" | "EXCEPTION";
  detail: string;
  shiftLabel: string | null;
  zenhrEntry: string | null;
  zenhrExit: string | null;
  workedHours: number | null;
  bricksVisits: number | null;
  timeoffName: string | null;
  flags: Flag[];
  suggestedReason: string | null;
}

export type Bucket = "EMERGENCY" | "ANNUAL" | "UNPAID" | "BUSINESS_MISSION" | "NONE";

export interface Reason {
  code: string;
  label: string;
  color: string;
  defaultBucket: Bucket;
  allowsToggle: boolean;
  defaultDays: number;
  hoursEditable: boolean;
}

export interface Balances {
  emergency: { usedThisYear: number };
  annual: { usedThisYear: number };
  remaining: { emergency: number | null; annual: number | null } | null;
}

export interface ReconcileResponse {
  from: string;
  to: string;
  rows: Row[];
  summary: {
    totalRows: number;
    present: number;
    timeOff: number;
    daysOff: number;
    exceptions: number;
    unmatched: number;
    referenceFlags: number;
  };
  warnings: string[];
  balances: Record<string, Balances>;
  reasons: Reason[];
  applyEnabled?: boolean;
  error?: string;
}

export interface ApplyResult {
  employmentNumber: string;
  date: string;
  ok: boolean;
  skipped?: boolean;
  message: string;
}

export function rowKey(row: { employmentNumber: string; date: string }): string {
  return `${row.employmentNumber}|${row.date}`;
}
