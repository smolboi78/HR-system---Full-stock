from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import Employee, User
from app.services import reports

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _period(period_start: date | None, period_end: date | None) -> tuple[date, date]:
    if period_start and period_end:
        return period_start, period_end
    end = date.today()
    return end - timedelta(days=30), end


def _get_employee(db: Session, employee_id: str) -> Employee:
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return employee


@router.get("/employee/{employee_id}/excel")
def employee_excel(
    employee_id: str,
    period_start: date | None = Query(default=None),
    period_end: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    employee = _get_employee(db, employee_id)
    start, end = _period(period_start, period_end)
    content = reports.employee_report_excel(db, employee, start, end)
    filename = f"{employee.display_name.replace(' ', '_')}_{start}_{end}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/employee/{employee_id}/pdf")
def employee_pdf(
    employee_id: str,
    period_start: date | None = Query(default=None),
    period_end: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    employee = _get_employee(db, employee_id)
    start, end = _period(period_start, period_end)
    try:
        content = reports.employee_report_pdf(db, employee, start, end)
    except RuntimeError as err:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(err)) from err
    filename = f"{employee.display_name.replace(' ', '_')}_{start}_{end}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/joint/excel")
def joint_excel(
    period_start: date | None = Query(default=None),
    period_end: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    start, end = _period(period_start, period_end)
    content = reports.joint_report_excel(db, start, end)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="all_employees_{start}_{end}.xlsx"'},
    )


@router.get("/joint/pdf")
def joint_pdf(
    period_start: date | None = Query(default=None),
    period_end: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    start, end = _period(period_start, period_end)
    try:
        content = reports.joint_report_pdf(db, start, end)
    except RuntimeError as err:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(err)) from err
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="all_employees_{start}_{end}.pdf"'},
    )
