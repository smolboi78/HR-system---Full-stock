from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_admin
from app.models import (
    AttendanceRecord,
    Employee,
    EmployeeCategory,
    LeaveTransaction,
    OnboardingStatus,
    User,
    VacationTransaction,
    Visit,
)
from app.schemas import (
    ConfirmEmployeeRequest,
    EmployeeCardOut,
    EmployeeProfileOut,
    VacationOverrideRequest,
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
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[EmployeeCardOut]:
    start, end = _parse_period(period_start, period_end)

    query = db.query(Employee)
    if not include_excluded:
        query = query.filter(Employee.category != EmployeeCategory.EXCLUDED)
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
                category=emp.category,
                photo_url=emp.photo_url,
                active=emp.active,
                onboarding_status=emp.onboarding_status,
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
    leave = (
        db.query(LeaveTransaction)
        .filter(
            LeaveTransaction.employee_id == employee.id,
            LeaveTransaction.leave_date >= start,
            LeaveTransaction.leave_date <= end,
        )
        .order_by(LeaveTransaction.leave_date.desc())
        .all()
    )
    vacation = (
        db.query(VacationTransaction)
        .filter(
            VacationTransaction.employee_id == employee.id,
            VacationTransaction.vacation_date >= start,
            VacationTransaction.vacation_date <= end,
        )
        .order_by(VacationTransaction.vacation_date.desc())
        .all()
    )
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

    override = employee.vacation_balance_override_days
    effective = override if override is not None else employee.vacation_balance_days

    return EmployeeProfileOut(
        id=employee.id,
        display_name=employee.display_name,
        job_title=employee.job_title,
        department=employee.department,
        category=employee.category,
        photo_url=employee.photo_url,
        active=employee.active,
        hiring_date=employee.hiring_date,
        onboarding_status=employee.onboarding_status,
        vacation_balance_days=employee.vacation_balance_days,
        vacation_balance_override_days=employee.vacation_balance_override_days,
        vacation_balance_effective_days=effective,
        vacation_balance_synced_at=employee.vacation_balance_synced_at,
        period_hours=summary.hours,
        period_visits=summary.visits,
        period_days_present=summary.days_present,
        period_days_expected=summary.days_expected,
        period_days_absent=summary.days_absent,
        attendance=attendance,
        leave=leave,
        vacation=vacation,
        visits=visits,
    )


@router.get("/pending/new-hires", response_model=list[EmployeeCardOut])
def list_pending_new_hires(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[EmployeeCardOut]:
    employees = (
        db.query(Employee)
        .filter(Employee.onboarding_status == OnboardingStatus.PENDING_CONFIRMATION)
        .order_by(Employee.created_at.desc())
        .all()
    )
    return [
        EmployeeCardOut(
            id=e.id,
            display_name=e.display_name,
            job_title=e.job_title,
            department=e.department,
            category=e.category,
            photo_url=e.photo_url,
            active=e.active,
            onboarding_status=e.onboarding_status,
        )
        for e in employees
    ]


@router.post("/{employee_id}/confirm", response_model=EmployeeCardOut)
def confirm_new_hire(
    employee_id: str,
    payload: ConfirmEmployeeRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> EmployeeCardOut:
    employee = _get_employee_or_404(db, employee_id)
    if payload.category not in EmployeeCategory.__members__:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown category")
    employee.category = EmployeeCategory[payload.category]
    employee.onboarding_status = OnboardingStatus.ACTIVE
    db.commit()
    db.refresh(employee)
    return EmployeeCardOut(
        id=employee.id,
        display_name=employee.display_name,
        job_title=employee.job_title,
        department=employee.department,
        category=employee.category,
        photo_url=employee.photo_url,
        active=employee.active,
        onboarding_status=employee.onboarding_status,
    )


@router.put("/{employee_id}/vacation-override")
def set_vacation_override(
    employee_id: str,
    payload: VacationOverrideRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict:
    employee = _get_employee_or_404(db, employee_id)
    employee.vacation_balance_override_days = payload.override_days
    db.commit()
    return {"ok": True}
