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

from app.models import (
    VOID_TIMEOFF_STATUSES,
    AttendanceRecord,
    Employee,
    Holiday,
    TimeoffTransaction,
    Visit,
)


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


def _granted_timeoff_dates(db: Session, employee: Employee, start: date, end: date) -> set[date]:
    """Dates covered by leave that actually stands. Anything not explicitly
    cancelled/rejected/withdrawn/pending counts, so an approved vacation
    isn't scored as absence just because we can't predict how ZenHR spells
    its granted state."""
    rows = (
        db.query(TimeoffTransaction)
        .filter(
            TimeoffTransaction.employee_id == employee.id,
            TimeoffTransaction.from_date <= end,
            TimeoffTransaction.to_date >= start,
        )
        .all()
    )
    dates: set[date] = set()
    for row in rows:
        if (row.status or "").strip().lower().replace(" ", "_") in VOID_TIMEOFF_STATUSES:
            continue
        current = max(row.from_date, start)
        last = min(row.to_date, end)
        while current <= last:
            dates.add(current)
            current += timedelta(days=1)
    return dates


def expected_working_days(
    employee: Employee,
    start: date,
    end: date,
    holidays: set[date],
    timeoff_dates: frozenset[date] | set[date] = frozenset(),
) -> int:
    off_weekdays = set(employee.off_weekdays or [])
    count = 0
    current = start
    while current <= end:
        if (
            current.isoweekday() not in off_weekdays
            and current not in holidays
            and current not in timeoff_dates
        ):
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
    # A day counts as present if the employee actually clocked in. Matching
    # on a status string does NOT work here: ZenHR's missing_status carries
    # values like "complete" plus an open-ended set of absence reasons, so
    # the old `status == "present"` check only ever matched the demo seeder
    # and scored every real employee as 0 days present in production.
    days_present = len({a.attendance_date for a in attendance if a.entry_time is not None})

    # Every visit the rep actually made, planned or ad-hoc. Filtering to
    # unplanned only (as this used to) drops the scheduled route visits that
    # are most of a field team's work, and left the count at ~0.
    visits = (
        db.query(Visit)
        .filter(
            Visit.employee_id == employee.id,
            Visit.visit_time >= start,
            Visit.visit_time < end + timedelta(days=1),
        )
        .count()
    )

    if employee.track_attendance:
        holidays = _holiday_dates(db, start, end)
        timeoff_dates = _granted_timeoff_dates(db, employee, start, end)
        days_expected = expected_working_days(employee, start, end, holidays, timeoff_dates)
        days_absent = max(days_expected - days_present, 0)
    else:
        # Nobody expects them to clock in, so there are no days to be absent
        # for. Counting them would score a director as absent every working
        # day, here and in every report that reads this.
        days_expected = 0
        days_absent = 0

    return PeriodSummary(
        hours=round(hours, 2),
        visits=visits,
        days_present=days_present,
        days_expected=days_expected,
        days_absent=days_absent,
    )
