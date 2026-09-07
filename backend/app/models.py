import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _now() -> datetime:
    return datetime.utcnow()


# ---------- Auth ----------


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    VIEWER = "VIEWER"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: __import__("uuid").uuid4().hex)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    role: Mapped[UserRole] = mapped_column(String, default=UserRole.VIEWER)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ---------- Employee categorization ----------


class EmployeeCategory(str, enum.Enum):
    MANAGEMENT = "MANAGEMENT"
    SALES = "SALES"
    COLLECTOR = "COLLECTOR"
    DELIVERY_AGENT = "DELIVERY_AGENT"
    SALES_SUPPORT = "SALES_SUPPORT"
    EXCLUDED = "EXCLUDED"
    UNASSIGNED = "UNASSIGNED"


class OnboardingStatus(str, enum.Enum):
    PENDING_CONFIRMATION = "PENDING_CONFIRMATION"
    ACTIVE = "ACTIVE"


class JobRoleCategoryRule(Base):
    """Maps a ZenHR job title string to a dashboard category, used to
    auto-assign new employees' metric type. Checked as a fallback when no
    DepartmentCategoryRule matches - see sync_employees()."""

    __tablename__ = "job_role_category_rules"

    job_role: Mapped[str] = mapped_column(String, primary_key=True)
    category: Mapped[EmployeeCategory] = mapped_column(String)


class DepartmentCategoryRule(Base):
    """Maps a ZenHR department string to a dashboard category. Takes
    priority over JobRoleCategoryRule when assigning a new employee's
    metric type, since department is usually the more reliable signal."""

    __tablename__ = "department_category_rules"

    department: Mapped[str] = mapped_column(String, primary_key=True)
    category: Mapped[EmployeeCategory] = mapped_column(String)


# ---------- Employees ----------


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: __import__("uuid").uuid4().hex)

    zenhr_employee_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    zenhr_branch_id: Mapped[int] = mapped_column(Integer, index=True, default=0)
    employment_number: Mapped[str] = mapped_column(String)
    display_name: Mapped[str] = mapped_column(String)
    first_name: Mapped[str] = mapped_column(String, default="")
    last_name: Mapped[str] = mapped_column(String, default="")
    photo_url: Mapped[str | None] = mapped_column(String, nullable=True)

    job_title: Mapped[str | None] = mapped_column(String, nullable=True)
    department: Mapped[str | None] = mapped_column(String, nullable=True)
    manager_name: Mapped[str | None] = mapped_column(String, nullable=True)
    manager_zenhr_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category: Mapped[EmployeeCategory] = mapped_column(String, default=EmployeeCategory.UNASSIGNED)
    onboarding_status: Mapped[OnboardingStatus] = mapped_column(
        String, default=OnboardingStatus.PENDING_CONFIRMATION
    )

    active: Mapped[bool] = mapped_column(Boolean, default=True)
    hiring_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    termination_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Working-day pattern pulled from the employee's ZenHR shift assignment:
    # ISO weekday numbers (1=Mon..7=Sun) that are NOT working days for them.
    off_weekdays: Mapped[list[int]] = mapped_column(__import__("sqlalchemy").JSON, default=list)

    # Bricks linkage - resolved automatically by owner_id once matched, or
    # pinned via a manual EmployeeNameOverride for known name mismatches.
    bricks_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    bricks_display_name: Mapped[str | None] = mapped_column(String, nullable=True)

    # ZenHR's API has no vacation-balance endpoint (confirmed - checked every
    # endpoint in their published Postman collection), so this is purely
    # admin-maintained, not synced from anywhere.
    vacation_balance_days: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class EmployeeNameOverride(Base):
    """Manual ZenHR<->Bricks name-mapping override for employees whose
    Bricks display name doesn't match their ZenHR name."""

    __tablename__ = "employee_name_overrides"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: __import__("uuid").uuid4().hex)
    employment_number: Mapped[str] = mapped_column(String, unique=True)
    bricks_display_name: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ---------- Attendance (ZenHR accumulative attendance report) ----------


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    __table_args__ = (UniqueConstraint("employee_id", "attendance_date", name="uq_attendance_employee_date"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: __import__("uuid").uuid4().hex)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), index=True)
    employee: Mapped["Employee"] = relationship()

    attendance_date: Mapped[date] = mapped_column(Date, index=True)
    entry_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    exit_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    worked_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # e.g. "present", "absent", "business_mission", "personal_excuse",
    # "uncompleted_shift", "unpaid_leave" - kept as a free string so new
    # ZenHR absence reasons don't require a migration.
    status: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(String, nullable=True)

    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ---------- Timeoff (ZenHR's single unified vacation/leave concept) ----------
#
# ZenHR doesn't split "vacation" and "leave" into separate endpoints the way
# the original spec described - both live in one timeoff_transactions
# endpoint, each referencing a TimeoffType (e.g. "Annual Vacation", a sick
# leave type, etc. - class_name AnnualVacation marks the vacation ones).


class TimeoffType(Base):
    """Synced from ZenHR's /timeoffs endpoint. class_name "AnnualVacation"
    is what the spec's "vacation-by-day" refers to; everything else is the
    spec's "leave" concept."""

    __tablename__ = "timeoff_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # ZenHR's own id
    name: Mapped[str] = mapped_column(String)
    class_name: Mapped[str] = mapped_column(String)
    is_sick_vacation: Mapped[bool] = mapped_column(Boolean, default=False)


# Statuses that count as a protected day off (don't count as absence).
# UNCONFIRMED exact spelling ZenHR uses - see docs/api-endpoint-mapping.md.
PROTECTED_TIMEOFF_STATUSES = {"approved", "added_by_hr", "added by hr"}


class TimeoffTransaction(Base):
    __tablename__ = "timeoff_transactions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: __import__("uuid").uuid4().hex)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), index=True)
    zenhr_transaction_id: Mapped[int] = mapped_column(Integer, unique=True)
    timeoff_type_id: Mapped[int | None] = mapped_column(ForeignKey("timeoff_types.id"), nullable=True)
    timeoff_type: Mapped["TimeoffType | None"] = relationship()

    from_date: Mapped[date] = mapped_column(Date, index=True)
    to_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)

    synced_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ---------- Visits (Bricks) ----------


class Visit(Base):
    __tablename__ = "visits"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: __import__("uuid").uuid4().hex)
    bricks_visit_id: Mapped[str] = mapped_column(String, unique=True)
    employee_id: Mapped[str | None] = mapped_column(ForeignKey("employees.id"), nullable=True, index=True)

    owner_bricks_id: Mapped[str] = mapped_column(String, index=True)
    owner_name_raw: Mapped[str] = mapped_column(String)
    contact_id: Mapped[str | None] = mapped_column(String, nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String, nullable=True)

    is_successful: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_planned: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String)
    visit_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    synced_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ---------- Holidays (Egypt, editable in settings) ----------


class Holiday(Base):
    __tablename__ = "holidays"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: __import__("uuid").uuid4().hex)
    holiday_date: Mapped[date] = mapped_column(Date, unique=True)
    name: Mapped[str] = mapped_column(String)


# ---------- Sync bookkeeping ----------


class SyncSource(str, enum.Enum):
    ZENHR = "ZENHR"
    BRICKS = "BRICKS"


class SyncStatus(str, enum.Enum):
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: __import__("uuid").uuid4().hex)
    source: Mapped[SyncSource] = mapped_column(String)
    status: Mapped[SyncStatus] = mapped_column(String, default=SyncStatus.RUNNING)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    records_synced: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class ZenhrOAuthToken(Base):
    """Single-row table holding the current ZenHR OAuth tokens."""

    __tablename__ = "zenhr_oauth_tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True, default="default")
    access_token: Mapped[str] = mapped_column(String)
    refresh_token: Mapped[str] = mapped_column(String)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    scope: Mapped[str] = mapped_column(String, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
