from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_admin
from app.models import (
    DepartmentCategoryRule,
    Employee,
    EmployeeCategory,
    EmployeeNameOverride,
    Holiday,
    JobRoleCategoryRule,
    User,
    Visit,
)
from app.schemas import (
    CategoryRuleOut,
    CategoryRuleRequest,
    DepartmentRuleOut,
    DepartmentRuleRequest,
    EmployeeOverrideOut,
    EmployeeOverrideRequest,
    HolidayCreateRequest,
    HolidayOut,
    LinkRepRequest,
    NameOverrideOut,
    NameOverrideRequest,
    SortEmployeeRequest,
    UnmatchedRepOut,
    UnsortedEmployeeOut,
    UserCreateRequest,
    UserOut,
    UserUpdateRequest,
)
from app.security import hash_password
from app.services import org_chart

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ---------- Holidays ----------


@router.get("/holidays", response_model=list[HolidayOut])
def list_holidays(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[Holiday]:
    return db.query(Holiday).order_by(Holiday.holiday_date).all()


@router.post("/holidays", response_model=HolidayOut)
def create_holiday(
    payload: HolidayCreateRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> Holiday:
    existing = db.query(Holiday).filter_by(holiday_date=payload.holiday_date).first()
    if existing:
        existing.name = payload.name
        db.commit()
        db.refresh(existing)
        return existing
    holiday = Holiday(holiday_date=payload.holiday_date, name=payload.name)
    db.add(holiday)
    db.commit()
    db.refresh(holiday)
    return holiday


@router.delete("/holidays/{holiday_id}")
def delete_holiday(holiday_id: str, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    holiday = db.get(Holiday, holiday_id)
    if not holiday:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Holiday not found")
    db.delete(holiday)
    db.commit()
    return {"ok": True}


# ---------- Job role -> category rules ----------


@router.get("/category-rules", response_model=list[CategoryRuleOut])
def list_category_rules(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[JobRoleCategoryRule]:
    return db.query(JobRoleCategoryRule).order_by(JobRoleCategoryRule.job_role).all()


@router.put("/category-rules", response_model=CategoryRuleOut)
def upsert_category_rule(
    payload: CategoryRuleRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> JobRoleCategoryRule:
    rule = db.get(JobRoleCategoryRule, payload.job_role)
    if rule:
        rule.category = payload.category
    else:
        rule = JobRoleCategoryRule(job_role=payload.job_role, category=payload.category)
        db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/category-rules/{job_role}")
def delete_category_rule(job_role: str, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    rule = db.get(JobRoleCategoryRule, job_role)
    if not rule:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rule not found")
    db.delete(rule)
    db.commit()
    return {"ok": True}


# ---------- Department -> category rules ----------


@router.get("/department-rules", response_model=list[DepartmentRuleOut])
def list_department_rules(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[DepartmentCategoryRule]:
    return db.query(DepartmentCategoryRule).order_by(DepartmentCategoryRule.department).all()


@router.put("/department-rules", response_model=DepartmentRuleOut)
def upsert_department_rule(
    payload: DepartmentRuleRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> DepartmentCategoryRule:
    rule = db.get(DepartmentCategoryRule, payload.department)
    if rule:
        rule.category = payload.category
    else:
        rule = DepartmentCategoryRule(department=payload.department, category=payload.category)
        db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/department-rules/{department}")
def delete_department_rule(department: str, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    rule = db.get(DepartmentCategoryRule, department)
    if not rule:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rule not found")
    db.delete(rule)
    db.commit()
    return {"ok": True}


# ---------- Per-employee title / group corrections ----------


def _validated_group(value: str | None) -> str | None:
    group = (value or "").strip()
    if group and group not in org_chart.ORG_GROUPS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown group '{group}' - must be one of: {', '.join(org_chart.ORG_GROUPS)}",
        )
    return group or None


def _validated_section(group: str | None, value: str | None) -> str | None:
    section = (value or "").strip()
    if not section:
        return None
    allowed = org_chart.SECTIONS_BY_GROUP.get(group or "", [])
    if section not in allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{section}' is not a section of '{group}'"
            + (f" - must be one of: {', '.join(allowed)}" if allowed else " - it has no sections"),
        )
    return section


def _override_row(employee: Employee) -> EmployeeOverrideOut:
    return EmployeeOverrideOut(
        id=employee.id,
        display_name=employee.display_name,
        synced_job_title=employee.job_title,
        synced_department=employee.department,
        job_title_override=employee.job_title_override,
        org_group_override=employee.org_group_override,
        org_section_override=employee.org_section_override,
        effective_job_title=employee.effective_job_title,
        effective_org_group=org_chart.group_for_employee(employee),
        effective_org_section=org_chart.section_for_employee(employee),
    )


@router.get("/employee-overrides", response_model=list[EmployeeOverrideOut])
def list_employee_overrides(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[EmployeeOverrideOut]:
    query = db.query(Employee)
    if not include_inactive:
        query = query.filter(Employee.active.is_(True))
    return [_override_row(e) for e in query.order_by(Employee.display_name).all()]


@router.put("/employee-overrides/{employee_id}", response_model=EmployeeOverrideOut)
def set_employee_override(
    employee_id: str,
    payload: EmployeeOverrideRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> EmployeeOverrideOut:
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    group = _validated_group(payload.org_group)
    section = _validated_section(group, payload.org_section)

    # Blank clears the override so the person falls back to ZenHR's value.
    employee.job_title_override = (payload.job_title or "").strip() or None
    employee.org_group_override = group
    employee.org_section_override = section
    db.commit()
    db.refresh(employee)
    return _override_row(employee)


# ---------- ZenHR <-> Bricks name overrides ----------


@router.get("/name-overrides", response_model=list[NameOverrideOut])
def list_name_overrides(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[EmployeeNameOverride]:
    return db.query(EmployeeNameOverride).order_by(EmployeeNameOverride.employment_number).all()


@router.post("/name-overrides", response_model=NameOverrideOut)
def create_name_override(
    payload: NameOverrideRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> EmployeeNameOverride:
    existing = db.query(EmployeeNameOverride).filter_by(employment_number=payload.employment_number).first()
    if existing:
        existing.bricks_display_name = payload.bricks_display_name
        existing.note = payload.note
        db.commit()
        db.refresh(existing)
        return existing
    override = EmployeeNameOverride(**payload.model_dump())
    db.add(override)
    db.commit()
    db.refresh(override)
    return override


@router.delete("/name-overrides/{override_id}")
def delete_name_override(override_id: str, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    override = db.get(EmployeeNameOverride, override_id)
    if not override:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Override not found")
    db.delete(override)
    db.commit()
    return {"ok": True}


# ---------- Directory sorting ----------


@router.get("/unsorted-employees", response_model=list[UnsortedEmployeeOut])
def list_unsorted_employees(
    db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> list[UnsortedEmployeeOut]:
    """Active employees no admin has placed yet. EXCLUDED people are left out
    entirely - they never appear in the directory, so there is nothing to
    sort them into and they would never let this list empty."""
    employees = (
        db.query(Employee)
        .filter(
            Employee.directory_confirmed.is_(False),
            Employee.active.is_(True),
            Employee.category != EmployeeCategory.EXCLUDED,
        )
        .order_by(Employee.display_name)
        .all()
    )
    rows = []
    for emp in employees:
        group, section = org_chart.place_for(emp.department, emp.effective_job_title)
        # Nothing matched their title or department. "Ungrouped" is not a
        # department anyone can be placed into, so offer no suggestion at all
        # and make the admin choose, rather than pre-filling a value the
        # dropdown can't offer and the API would reject.
        if group == org_chart.UNGROUPED:
            group, section = "", None
        rows.append(
            UnsortedEmployeeOut(
                id=emp.id,
                display_name=emp.display_name,
                job_title=emp.effective_job_title,
                department=emp.department,
                photo_url=emp.photo_url,
                suggested_group=group,
                suggested_section=section,
            )
        )
    return rows


@router.post("/unsorted-employees/{employee_id}/sort", response_model=EmployeeOverrideOut)
def sort_employee(
    employee_id: str,
    payload: SortEmployeeRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> EmployeeOverrideOut:
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    group = _validated_group(payload.org_group)
    if not group:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A department is required")

    sections = org_chart.SECTIONS_BY_GROUP.get(group, [])
    section = _validated_section(group, payload.org_section)
    if sections and not section:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{group}' needs a section - one of: {', '.join(sections)}",
        )

    employee.org_group_override = group
    employee.org_section_override = section
    employee.directory_confirmed = True
    db.commit()
    db.refresh(employee)
    return _override_row(employee)


# ---------- Unlinked Bricks reps ----------


@router.get("/unmatched-reps", response_model=list[UnmatchedRepOut])
def list_unmatched_reps(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[UnmatchedRepOut]:
    rows = (
        db.query(
            Visit.owner_bricks_id.label("owner_bricks_id"),
            func.max(Visit.owner_name_raw).label("owner_name_raw"),
            func.count(Visit.id).label("visit_count"),
            func.max(Visit.visit_time).label("last_visit_at"),
        )
        .filter(Visit.employee_id.is_(None))
        .group_by(Visit.owner_bricks_id)
        .order_by(func.count(Visit.id).desc())
        .all()
    )
    return [
        UnmatchedRepOut(
            owner_bricks_id=r.owner_bricks_id,
            # Bricks names arrive with stray leading/trailing spaces.
            owner_name_raw=(r.owner_name_raw or "").strip() or "(unnamed Bricks account)",
            visit_count=r.visit_count,
            last_visit_at=r.last_visit_at,
        )
        for r in rows
    ]


@router.post("/unmatched-reps/link")
def link_unmatched_rep(
    payload: LinkRepRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> dict:
    """Attach a Bricks account to an employee by its stable owner id.

    Pinning bricks_user_id rather than adding a name override means future
    syncs match on the id and stop depending on how the name is spelled.
    """
    employee = db.get(Employee, payload.employee_id)
    if not employee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    # One Bricks account belongs to one person - take it off whoever holds it.
    for other in db.query(Employee).filter(
        Employee.bricks_user_id == payload.owner_bricks_id, Employee.id != employee.id
    ):
        other.bricks_user_id = None

    employee.bricks_user_id = payload.owner_bricks_id

    # Reassign every visit from that account, not only the unattached ones, so
    # re-linking corrects a wrong mapping instead of stranding its visits.
    linked = (
        db.query(Visit)
        .filter(Visit.owner_bricks_id == payload.owner_bricks_id)
        .update({Visit.employee_id: employee.id}, synchronize_session=False)
    )
    db.commit()
    return {"linked_visits": linked, "employee_id": employee.id, "display_name": employee.display_name}


# ---------- Users (admin/view-only accounts) ----------


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> list[User]:
    return db.query(User).order_by(User.created_at).all()


@router.post("/users", response_model=UserOut)
def create_user(payload: UserCreateRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> User:
    email = payload.email.lower()
    if db.query(User).filter_by(email=email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with this email already exists")
    if payload.role not in ("ADMIN", "VIEWER"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "role must be ADMIN or VIEWER")
    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        name=payload.name,
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: str, payload: UserUpdateRequest, db: Session = Depends(get_db), admin: User = Depends(require_admin)
) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if payload.name is not None:
        user.name = payload.name
    if payload.role is not None:
        if payload.role not in ("ADMIN", "VIEWER"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "role must be ADMIN or VIEWER")
        user.role = payload.role
    if payload.active is not None:
        if user.id == admin.id and not payload.active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot deactivate your own account")
        user.active = payload.active
    if payload.password:
        user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return user
