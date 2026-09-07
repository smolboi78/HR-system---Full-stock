from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import (
    AttendanceRecord,
    Employee,
    EmployeeCategory,
    EmployeeNameOverride,
    JobRoleCategoryRule,
    OnboardingStatus,
    SyncRun,
    SyncSource,
    SyncStatus,
    Visit,
)
from app.services import bricks_client, zenhr_client


def _run(db: Session, source: SyncSource, fn) -> SyncRun:
    run = SyncRun(source=source, status=SyncStatus.RUNNING)
    db.add(run)
    db.commit()
    db.refresh(run)
    try:
        count = fn()
        run.status = SyncStatus.SUCCESS
        run.records_synced = count
    except Exception as err:  # noqa: BLE001 - recorded on the run, then re-raised
        run.status = SyncStatus.FAILED
        run.error_message = str(err)
        run.finished_at = datetime.utcnow()
        db.commit()
        raise
    run.finished_at = datetime.utcnow()
    db.commit()
    return run


def _display_name(emp: dict) -> tuple[str, str, str]:
    name = ((emp.get("user") or {}).get("name") or {}).get("en") or {}
    first = (name.get("first_name") or "").strip()
    last = (name.get("last_name") or "").strip()
    display = " ".join(p for p in (first, last) if p) or f"Employee {emp.get('employment_number')}"
    return first, last, display


def sync_employees(db: Session) -> SyncRun:
    def _do() -> int:
        overrides = {o.employment_number: o.bricks_display_name for o in db.query(EmployeeNameOverride).all()}
        category_by_role = {r.job_role: r.category for r in db.query(JobRoleCategoryRule).all()}

        count = 0
        branches = zenhr_client.list_branches(db)
        for branch in branches:
            for emp in zenhr_client.list_employees(db, branch["id"]):
                first, last, display = _display_name(emp)
                employment_number = str(emp["employment_number"])
                job_role = zenhr_client.extract_job_role(emp)
                category = category_by_role.get(job_role) if job_role else None

                existing = db.query(Employee).filter_by(zenhr_employee_id=emp["id"]).first()
                is_new = existing is None
                employee = existing or Employee(zenhr_employee_id=emp["id"])

                employee.employment_number = employment_number
                employee.first_name = first
                employee.last_name = last
                employee.display_name = display
                employee.active = emp.get("active", True)
                employee.hiring_date = emp.get("hiring_date")
                employee.termination_date = emp.get("termination_date")
                employee.job_title = job_role
                if is_new:
                    employee.category = category or EmployeeCategory.UNASSIGNED
                    employee.onboarding_status = OnboardingStatus.PENDING_CONFIRMATION
                    employee.bricks_display_name = overrides.get(employment_number, display)
                elif employment_number in overrides:
                    employee.bricks_display_name = overrides[employment_number]
                # Known job role now maps to a category and the employee
                # hasn't been through new-hire confirmation yet: apply it,
                # but never silently overwrite a human's confirmed choice.
                if category and employee.onboarding_status == OnboardingStatus.PENDING_CONFIRMATION:
                    employee.category = category

                if is_new:
                    db.add(employee)
                count += 1
        db.commit()
        return count

    return _run(db, SyncSource.ZENHR, _do)


def _worked_minutes(entry: str | None, exit_: str | None) -> int | None:
    if not entry or not exit_:
        return None
    delta = datetime.fromisoformat(exit_) - datetime.fromisoformat(entry)
    minutes = round(delta.total_seconds() / 60)
    return minutes if minutes > 0 else None


def sync_attendance(db: Session, date_from: str, date_to: str) -> SyncRun:
    def _do() -> int:
        count = 0
        for branch in zenhr_client.list_branches(db):
            for rec in zenhr_client.list_attendance_records(db, branch["id"], date_from, date_to):
                employee = db.query(Employee).filter_by(zenhr_employee_id=rec["employee"]["id"]).first()
                if not employee:
                    continue  # run sync_employees first; skip rather than fail the batch

                existing = db.query(AttendanceRecord).filter_by(
                    employee_id=employee.id, attendance_date=rec["attendance_date"]
                ).first()
                row = existing or AttendanceRecord(employee_id=employee.id, attendance_date=rec["attendance_date"])
                row.entry_time = rec.get("entry_time")
                row.exit_time = rec.get("exit_time")
                row.worked_minutes = _worked_minutes(rec.get("entry_time"), rec.get("exit_time"))
                row.status = rec.get("missing_status", "present")
                row.source_updated_at = rec.get("updated_at")
                if not existing:
                    db.add(row)
                count += 1
        db.commit()
        return count

    return _run(db, SyncSource.ZENHR, _do)


def _normalize(name: str) -> str:
    return " ".join(name.strip().lower().split())


def sync_visits(db: Session, created_from: str, created_to: str) -> SyncRun:
    def _do() -> int:
        employees = db.query(Employee).all()
        by_bricks_id = {e.bricks_user_id: e for e in employees if e.bricks_user_id}
        by_name = {_normalize(e.bricks_display_name or e.display_name): e for e in employees}

        count = 0
        offset = 0
        limit = 200
        while True:
            visits = bricks_client.list_visits(created_from, created_to, limit=limit, offset=offset)
            for visit in visits:
                owner_id = visit["owner_id"]
                owner_name = visit["owner"]["name"]
                employee = by_bricks_id.get(owner_id) or by_name.get(_normalize(owner_name))
                if employee and not employee.bricks_user_id:
                    employee.bricks_user_id = owner_id
                    by_bricks_id[owner_id] = employee

                existing = db.query(Visit).filter_by(bricks_visit_id=visit["id"]).first()
                row = existing or Visit(bricks_visit_id=visit["id"])
                row.employee_id = employee.id if employee else None
                row.owner_bricks_id = owner_id
                row.owner_name_raw = owner_name
                row.contact_id = visit.get("contact_id")
                row.contact_name = (visit.get("contact") or {}).get("name")
                row.is_successful = visit.get("is_successful")
                row.is_planned = visit.get("is_planned", False)
                row.status = visit.get("status", "")
                row.visit_time = visit["visit_time"]
                row.duration_ms = visit.get("duration")
                if not existing:
                    db.add(row)
                count += 1
            db.commit()
            if len(visits) < limit:
                break
            offset += limit
        return count

    return _run(db, SyncSource.BRICKS, _do)


DEFAULT_SYNC_WINDOW_DAYS = 10


def run_full_sync(db: Session) -> list[SyncRun]:
    """Runs the same trailing window every time (not just "today") so late
    punches, corrections, or a missed scheduled run still get picked up."""
    to = datetime.utcnow().date()
    frm = to - timedelta(days=DEFAULT_SYNC_WINDOW_DAYS)
    runs = [sync_employees(db), sync_attendance(db, frm.isoformat(), to.isoformat())]
    try:
        runs.append(sync_visits(db, frm.isoformat(), to.isoformat()))
    except RuntimeError:
        pass  # BRICKS_API_KEY not configured yet - ZenHR sync still ran
    return runs
