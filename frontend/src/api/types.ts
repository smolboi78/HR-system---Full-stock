export interface User {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "VIEWER";
  active: boolean;
}

export type EmployeeCategory =
  | "MANAGEMENT"
  | "SALES"
  | "COLLECTOR"
  | "DELIVERY_AGENT"
  | "SALES_SUPPORT"
  | "EXCLUDED"
  | "UNASSIGNED";

export interface EmployeeCard {
  id: string;
  display_name: string;
  job_title: string | null;
  department: string | null;
  manager_name: string | null;
  category: EmployeeCategory;
  photo_url: string | null;
  active: boolean;
  onboarding_status: "PENDING_CONFIRMATION" | "ACTIVE";
  period_hours: number | null;
  period_visits: number | null;
  period_days_present: number | null;
  period_days_expected: number | null;
}

export interface AttendanceDay {
  attendance_date: string;
  entry_time: string | null;
  exit_time: string | null;
  worked_minutes: number | null;
  status: string;
  note: string | null;
}

export interface TimeoffTransaction {
  from_date: string;
  to_date: string;
  amount: number;
  status: string;
  notes: string | null;
  type_name: string | null;
  is_vacation: boolean;
}

export interface Visit {
  visit_time: string;
  contact_name: string | null;
  status: string;
  is_successful: boolean | null;
  is_planned: boolean;
}

export interface EmployeeProfile {
  id: string;
  display_name: string;
  job_title: string | null;
  department: string | null;
  manager_name: string | null;
  category: EmployeeCategory;
  photo_url: string | null;
  active: boolean;
  hiring_date: string | null;
  onboarding_status: "PENDING_CONFIRMATION" | "ACTIVE";

  // ZenHR has no vacation-balance endpoint (confirmed) - purely
  // admin-maintained, not synced.
  vacation_balance_days: number | null;

  period_hours: number;
  period_visits: number;
  period_days_present: number;
  period_days_expected: number;
  period_days_absent: number;

  attendance: AttendanceDay[];
  timeoff: TimeoffTransaction[];
  visits: Visit[];
}

export interface Holiday {
  id: string;
  holiday_date: string;
  name: string;
}

export interface CategoryRule {
  job_role: string;
  category: EmployeeCategory;
}

export interface DepartmentRule {
  department: string;
  category: EmployeeCategory;
}

export interface NameOverride {
  id: string;
  employment_number: string;
  bricks_display_name: string;
  note: string | null;
}

export interface SyncRun {
  id: string;
  source: "ZENHR" | "BRICKS";
  status: "RUNNING" | "SUCCESS" | "FAILED";
  started_at: string;
  finished_at: string | null;
  records_synced: number;
  error_message: string | null;
}
