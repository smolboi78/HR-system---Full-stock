from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_admin
from app.models import (
    AttendanceRecord,
    Employee,
    EmployeeCategory,
    TimeoffTransaction,
    User,
    Visit,
)
from app.schemas import (
    EmployeeCardOut,
    EmployeeProfileOut,
    TimeoffTransactionOut,
    VacationBalanceRequest,
)
from app.services.metrics import compute_period_summary

router = APIRouter(prefix="/api/employees", tags=["employees"])


def _default_period() -> tuple[date, date]:
    end = date.today()
    start = end - timedelta(days=30)
    return start, end


def _parse_period(period_start: date | None, period_end: date | None) -> tuple[date, date]:
    if period_start and period_end:
        if period_start > period_end:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "period_start must be before period_end")
        return period_start, period_end
    return _default_period()


@router.get("", response_model=list[EmployeeCardOut])
def list_employees(
    period_start: date | None = Query(default=None),
    period_end: date | None = Query(default=None),
    include_excluded: bool = Query(default=False),
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[EmployeeCardOut]:
    start, end = _parse_period(period_start, period_end)

    query = db.query(Employee)
    if not include_excluded:
        query = query.filter(Employee.category != EmployeeCategory.EXCLUDED)
    if not include_inactive:
        query = query.filter(Employee.active.is_(True))
    employees = query.order_by(Employee.display_name).all()

    cards = []
    for emp in employees:
        summary = compute_period_summary(db, emp, start, end)
        cards.append(
            EmployeeCardOut(
                id=emp.id,
                display_name=emp.display_name,
                job_title=emp.job_title,
                department=emp.department,
                manager_name=emp.manager_name,
                category=emp.category,
                photo_url=emp.photo_url,
                active=emp.active,
                period_hours=summary.hours,
                period_visits=summary.visits,
                period_days_present=summary.days_present,
                period_days_expected=summary.days_expected,
            )
        )
    return cards


def _get_employee_or_404(db: Session, employee_id: str) -> Employee:
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return employee


@router.get("/{employee_id}", response_model=EmployeeProfileOut)
def get_employee_profile(
    employee_id: str,
    period_start: date | None = Query(default=None),
    period_end: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> EmployeeProfileOut:
    employee = _get_employee_or_404(db, employee_id)
    start, end = _parse_period(period_start, period_end)
    summary = compute_period_summary(db, employee, start, end)

    attendance = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.employee_id == employee.id,
            AttendanceRecord.attendance_date >= start,
            AttendanceRecord.attendance_date <= end,
        )
        .order_by(AttendanceRecord.attendance_date.desc())
        .all()
    )
    timeoff_rows = (
        db.query(TimeoffTransaction)
        .filter(
            TimeoffTransaction.employee_id == employee.id,
            TimeoffTransaction.from_date <= end,
            TimeoffTransaction.to_date >= start,
        )
        .order_by(TimeoffTransaction.from_date.desc())
        .all()
    )
    timeoff = [
        TimeoffTransactionOut(
            from_date=t.from_date,
            to_date=t.to_date,
            amount=t.amount,
            status=t.status,
            notes=t.notes,
            type_name=t.timeoff_type.name if t.timeoff_type else None,
            is_vacation=bool(t.timeoff_type and t.timeoff_type.class_name == "AnnualVacation"),
        )
        for t in timeoff_rows
    ]
    visits = (
        db.query(Visit)
        .filter(
            Visit.employee_id == employee.id,
            Visit.visit_time >= start,
            Visit.visit_time < end + timedelta(days=1),
        )
        .order_by(Visit.visit_time.desc())
        .all()
    )

    return EmployeeProfileOut(
        id=employee.id,
        display_name=employee.display_name,
        job_title=employee.job_title,
        department=employee.department,
        manager_name=employee.manager_name,
        category=employee.category,
        photo_url=employee.photo_url,
        active=employee.active,
        hiring_date=employee.hiring_date,
        vacation_balance_days=employee.vacation_balance_days,
        period_hours=summary.hours,
        period_visits=summary.visits,
        period_days_present=summary.days_present,
        period_days_expected=summary.days_expected,
        period_days_absent=summary.days_absent,
        attendance=attendance,
        timeoff=timeoff,
        visits=visits,
    )


@router.put("/{employee_id}/vacation-balance")
def set_vacation_balance(
    employee_id: str,
    payload: VacationBalanceRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict:
    employee = _get_employee_or_404(db, employee_id)
    employee.vacation_balance_days = payload.balance_days
    db.commit()
    return {"ok": True}
