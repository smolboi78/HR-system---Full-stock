"""Period-scoped metric computation shared by the directory (card
mini-summary) and profile views.

Working-day counting: an employee's off-days come from their ZenHR shift
assignment (Employee.off_weekdays, ISO weekday numbers) rather than a
hardcoded per-role rule, plus the editable Holiday table. Co-Founder, HR
Consultant, Managing Director and anyone else marked EXCLUDED are filtered
out by callers before reaching here (see routers/employees.py).
"""

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models import AttendanceRecord, Employee, Holiday, Visit


@dataclass
class PeriodSummary:
    hours: float
    visits: int
    days_present: int
    days_expected: int
    days_absent: int


def _holiday_dates(db: Session, start: date, end: date) -> set[date]:
    rows = db.query(Holiday.holiday_date).filter(
        Holiday.holiday_date >= start, Holiday.holiday_date <= end
    )
    return {r[0] for r in rows}


def expected_working_days(employee: Employee, start: date, end: date, holidays: set[date]) -> int:
    off_weekdays = set(employee.off_weekdays or [])
    count = 0
    current = start
    while current <= end:
        if current.isoweekday() not in off_weekdays and current not in holidays:
            count += 1
        current += timedelta(days=1)
    return count


def compute_period_summary(db: Session, employee: Employee, start: date, end: date) -> PeriodSummary:
    attendance = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.employee_id == employee.id,
            AttendanceRecord.attendance_date >= start,
            AttendanceRecord.attendance_date <= end,
        )
        .all()
    )
    hours = sum((a.worked_minutes or 0) for a in attendance) / 60
    days_present = sum(1 for a in attendance if a.status == "present")

    visits = (
        db.query(Visit)
        .filter(
            Visit.employee_id == employee.id,
            Visit.visit_time >= start,
            Visit.visit_time < end + timedelta(days=1),
            Visit.is_planned.is_(False),
        )
        .count()
    )

    holidays = _holiday_dates(db, start, end)
    days_expected = expected_working_days(employee, start, end, holidays)
    days_absent = max(days_expected - days_present, 0)

    return PeriodSummary(
        hours=round(hours, 2),
        visits=visits,
        days_present=days_present,
        days_expected=days_expected,
        days_absent=days_absent,
    )
