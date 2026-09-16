from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    name: str
    role: str
    active: bool


class LoginResponse(BaseModel):
    user: UserOut
    access_token: str


class UserCreateRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "VIEWER"


class UserUpdateRequest(BaseModel):
    name: str | None = None
    role: str | None = None
    active: bool | None = None
    password: str | None = None


# ---------- Departments ----------


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    # The department's sections, in org-chart order. Empty for a flat
    # department, which renders no sub-tabs.
    sections: list[str] = []


# ---------- Employees ----------


class EmployeeCardOut(BaseModel):
    id: str
    display_name: str
    job_title: str | None
    department: str | None
    manager_name: str | None = None
    category: str
    photo_url: str | None
    active: bool
    # Which org-chart group this person belongs to - drives the directory's
    # department tabs. Derived from role/department, see services/org_chart.
    org_group: str = ""
    # The sub-tab within that department, or null for a department with no
    # sections (Commercial).
    org_section: str | None = None
    period_hours: float | None = None
    period_visits: int | None = None
    period_days_present: int | None = None
    period_days_expected: int | None = None


class AttendanceDayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    attendance_date: date
    entry_time: datetime | None
    exit_time: datetime | None
    worked_minutes: int | None
    status: str
    note: str | None


class TimeoffTransactionOut(BaseModel):
    from_date: date
    to_date: date
    amount: float
    status: str
    notes: str | None
    type_name: str | None
    is_vacation: bool


class VisitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    visit_time: datetime
    contact_name: str | None
    status: str
    is_successful: bool | None
    is_planned: bool


class EmployeeProfileOut(BaseModel):
    id: str
    display_name: str
    job_title: str | None
    department: str | None
    manager_name: str | None
    category: str
    photo_url: str | None
    active: bool
    hiring_date: date | None

    # ZenHR has no vacation-balance endpoint (confirmed) - purely
    # admin-maintained, not synced.
    vacation_balance_days: float | None

    period_hours: float
    period_visits: int
    period_days_present: int
    period_days_expected: int
    period_days_absent: int

    attendance: list[AttendanceDayOut]
    timeoff: list[TimeoffTransactionOut]
    visits: list[VisitOut]


class VacationBalanceRequest(BaseModel):
    balance_days: float | None


class EmployeeOverrideOut(BaseModel):
    """One row of the Settings editor: what ZenHR sent, what the admin has
    corrected it to, and where the person currently lands as a result."""

    id: str
    display_name: str

    synced_job_title: str | None
    synced_department: str | None

    job_title_override: str | None
    org_group_override: str | None
    org_section_override: str | None

    effective_job_title: str | None
    effective_org_group: str
    effective_org_section: str | None


class EmployeeOverrideRequest(BaseModel):
    # Empty string or null clears the override and falls back to ZenHR.
    job_title: str | None = None
    org_group: str | None = None
    org_section: str | None = None


class UnsortedEmployeeOut(BaseModel):
    """Someone no admin has placed yet. They stay out of the directory until
    they are sorted, which is what empties this list."""

    id: str
    display_name: str
    job_title: str | None
    department: str | None
    photo_url: str | None
    # Where they would land if placed automatically, offered as the default.
    # Empty when no rule matched them and there is nothing to suggest.
    suggested_group: str
    suggested_section: str | None


class SortEmployeeRequest(BaseModel):
    org_group: str
    # Required for a department that has sections; ignored for a flat one.
    org_section: str | None = None


# ---------- Settings ----------


class HolidayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    holiday_date: date
    name: str


class HolidayCreateRequest(BaseModel):
    holiday_date: date
    name: str


class CategoryRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_role: str
    category: str


class CategoryRuleRequest(BaseModel):
    job_role: str
    category: str


class DepartmentRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    department: str
    category: str


class DepartmentRuleRequest(BaseModel):
    department: str
    category: str


class NameOverrideOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    employment_number: str
    bricks_display_name: str
    note: str | None


class NameOverrideRequest(BaseModel):
    employment_number: str
    bricks_display_name: str
    note: str | None = None


class UnmatchedRepOut(BaseModel):
    """A Bricks account whose visits belong to nobody in ZenHR. Until it is
    linked, those visits sit in the database and every card reads 0."""

    owner_bricks_id: str
    owner_name_raw: str
    visit_count: int
    last_visit_at: datetime


class LinkRepRequest(BaseModel):
    owner_bricks_id: str
    employee_id: str


class SyncRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    records_synced: int
    error_message: str | None
