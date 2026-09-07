import time
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import (
    AttendanceRecord,
    DepartmentCategoryRule,
    Employee,
    EmployeeCategory,
    EmployeeNameOverride,
    JobRoleCategoryRule,
    OnboardingStatus,
    SyncRun,
    SyncSource,
    SyncStatus,
    TimeoffTransaction,
    TimeoffType,
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
    """Core identity fields only - job title/department/manager come from
    the separate professional_data endpoint, see sync_professional_data()."""

    def _do() -> int:
        overrides = {o.employment_number: o.bricks_display_name for o in db.query(EmployeeNameOverride).all()}

        count = 0
        branches = zenhr_client.list_branches(db)
        for branch in branches:
            for emp in zenhr_client.list_employees(db, branch["id"]):
                first, last, display = _display_name(emp)
                employment_number = str(emp["employment_number"])

                existing = db.query(Employee).filter_by(zenhr_employee_id=emp["id"]).first()
                is_new = existing is None
                employee = existing or Employee(zenhr_employee_id=emp["id"])

                employee.zenhr_branch_id = branch["id"]
                employee.employment_number = employment_number
                employee.first_name = first
                employee.last_name = last
                employee.display_name = display
                employee.active = emp.get("active", True)
                employee.hiring_date = emp.get("hiring_date")
                employee.termination_date = emp.get("termination_date")
                if is_new:
                    employee.category = EmployeeCategory.UNASSIGNED
                    employee.onboarding_status = OnboardingStatus.PENDING_CONFIRMATION
                    employee.bricks_display_name = overrides.get(employment_number, display)
                elif employment_number in overrides:
                    employee.bricks_display_name = overrides[employment_number]

                if is_new:
                    db.add(employee)
                count += 1
        db.commit()
        return count

    return _run(db, SyncSource.ZENHR, _do)


def sync_professional_data(db: Session, request_delay_s: float = 0.3) -> SyncRun:
    """One request per employee (no branch-level bulk endpoint exists for
    this) - sets job title/department/manager, and applies the department/
    job-title category rules to anyone still pending new-hire confirmation."""

    def _do() -> int:
        category_by_department = {r.department: r.category for r in db.query(DepartmentCategoryRule).all()}
        category_by_role = {r.job_role: r.category for r in db.query(JobRoleCategoryRule).all()}

        count = 0
        for branch in zenhr_client.list_branches(db):
            employees = db.query(Employee).filter_by(zenhr_branch_id=branch["id"]).all()
            for employee in employees:
                data = zenhr_client.get_employee_active_professional_data(db, branch["id"], employee.zenhr_employee_id)
                time.sleep(request_delay_s)
                if not data:
                    continue

                job_title = (data.get("position") or {}).get("name")
                department = (data.get("department") or {}).get("name")
                manager = data.get("manager") or {}

                employee.job_title = job_title
                employee.department = department
                employee.manager_name = manager.get("name")
                employee.manager_zenhr_id = manager.get("id")

                category = (department and category_by_department.get(department)) or (
                    job_title and category_by_role.get(job_title)
                )
                if category and employee.onboarding_status == OnboardingStatus.PENDING_CONFIRMATION:
                    employee.category = category

                count += 1
            db.commit()
        return count

    return _run(db, SyncSource.ZENHR, _do)


def sync_shifts(db: Session) -> SyncRun:
    """Branch-level bulk endpoints, no N+1 - see zenhr_client for the
    ZenHR-weekday-to-ISO-weekday conversion."""

    def _do() -> int:
        count = 0
        today = datetime.utcnow().date()
        for branch in zenhr_client.list_branches(db):
            work_shift_off_days = {
                ws["id"]: [zenhr_client.zenhr_weekday_to_iso(d) for d in ws.get("days_off", [])]
                for ws in zenhr_client.list_work_shifts(db, branch["id"])
            }

            assignments_by_employee: dict[int, list[dict]] = {}
            for assignment in zenhr_client.list_branch_employee_shifts(db, branch["id"]):
                emp_id = assignment["employee"]["id"]
                assignments_by_employee.setdefault(emp_id, []).append(assignment)

            employees = {
                e.zenhr_employee_id: e
                for e in db.query(Employee).filter_by(zenhr_branch_id=branch["id"]).all()
            }
            for emp_id, assignments in assignments_by_employee.items():
                employee = employees.get(emp_id)
                if not employee:
                    continue

                def _covers_today(a: dict) -> bool:
                    from_date = a.get("from_date", "")[:10]
                    to_date = a.get("to_date") or ""
                    to_date = to_date[:10] if to_date else None
                    return from_date <= today.isoformat() and (to_date is None or today.isoformat() <= to_date)

                current = next((a for a in assignments if _covers_today(a)), None)
                if not current:
                    current = max(assignments, key=lambda a: a.get("from_date", ""))

                work_shift_id = current["work_shift"]["id"]
                employee.off_weekdays = work_shift_off_days.get(work_shift_id, [])
                count += 1
            db.commit()
        return count

    return _run(db, SyncSource.ZENHR, _do)


def sync_timeoffs(db: Session, date_from: str, date_to: str) -> SyncRun:
    """Unified vacation + leave sync - see TimeoffType/TimeoffTransaction in
    models.py for why this replaced the originally-planned separate
    leave-by-hour/vacation-by-day tables."""

    def _do() -> int:
        count = 0
        for branch in zenhr_client.list_branches(db):
            for t in zenhr_client.list_timeoff_types(db, branch["id"]):
                existing = db.get(TimeoffType, t["id"])
                row = existing or TimeoffType(id=t["id"])
                row.name = (t.get("name") or {}).get("en") or (t.get("name") or {}).get("ar") or ""
                row.class_name = t.get("class_name", "")
                row.is_sick_vacation = t.get("is_sick_vacation", False)
                if not existing:
                    db.add(row)
            db.commit()

            for tx in zenhr_client.list_timeoff_transactions(db, branch["id"], date_from, date_to):
                employee = db.query(Employee).filter_by(zenhr_employee_id=tx["employee"]["id"]).first()
                if not employee:
                    continue

                existing = db.query(TimeoffTransaction).filter_by(zenhr_transaction_id=tx["id"]).first()
                row = existing or TimeoffTransaction(employee_id=employee.id, zenhr_transaction_id=tx["id"])
                row.employee_id = employee.id
                row.timeoff_type_id = (tx.get("timeoff") or {}).get("id")
                row.from_date = tx["from_date"][:10]
                row.to_date = tx["to_date"][:10]
                row.amount = tx.get("amount") or 0
                row.status = tx.get("status", "")
                row.notes = tx.get("notes") or None
                if not existing:
                    db.add(row)
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
    runs = [
        sync_employees(db),
        sync_professional_data(db),
        sync_shifts(db),
        sync_attendance(db, frm.isoformat(), to.isoformat()),
        sync_timeoffs(db, frm.isoformat(), to.isoformat()),
    ]
    try:
        runs.append(sync_visits(db, frm.isoformat(), to.isoformat()))
    except RuntimeError:
        pass  # BRICKS_API_KEY not configured yet - ZenHR sync still ran
    return runs
