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


# ---------- Employees ----------


class EmployeeCardOut(BaseModel):
    id: str
    display_name: str
    job_title: str | None
    department: str | None
    category: str
    photo_url: str | None
    active: bool
    onboarding_status: str
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


class LeaveTransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    leave_date: date
    hours: float
    leave_type: str
    status: str
    note: str | None


class VacationTransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    vacation_date: date
    status: str
    vacation_type: str | None
    note: str | None


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
    category: str
    photo_url: str | None
    active: bool
    hiring_date: date | None
    onboarding_status: str

    vacation_balance_days: float | None
    vacation_balance_override_days: float | None
    vacation_balance_effective_days: float | None
    vacation_balance_synced_at: datetime | None

    period_hours: float
    period_visits: int
    period_days_present: int
    period_days_expected: int
    period_days_absent: int

    attendance: list[AttendanceDayOut]
    leave: list[LeaveTransactionOut]
    vacation: list[VacationTransactionOut]
    visits: list[VisitOut]


class VacationOverrideRequest(BaseModel):
    override_days: float | None


class ConfirmEmployeeRequest(BaseModel):
    category: str


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


class SyncRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    records_synced: int
    error_message: str | None
