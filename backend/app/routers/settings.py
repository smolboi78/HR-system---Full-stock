from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_admin
from app.models import (
    DepartmentCategoryRule,
    Employee,
    EmployeeNameOverride,
    Holiday,
    JobRoleCategoryRule,
    User,
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
    NameOverrideOut,
    NameOverrideRequest,
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


def _override_row(employee: Employee) -> EmployeeOverrideOut:
    return EmployeeOverrideOut(
        id=employee.id,
        display_name=employee.display_name,
        synced_job_title=employee.job_title,
        synced_department=employee.department,
        job_title_override=employee.job_title_override,
        org_group_override=employee.org_group_override,
        effective_job_title=employee.effective_job_title,
        effective_org_group=org_chart.group_for_employee(employee),
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

    group = (payload.org_group or "").strip()
    if group and group not in org_chart.ORG_GROUPS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown group '{group}' - must be one of: {', '.join(org_chart.ORG_GROUPS)}",
        )

    # Blank clears the override so the person falls back to ZenHR's value.
    employee.job_title_override = (payload.job_title or "").strip() or None
    employee.org_group_override = group or None
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
