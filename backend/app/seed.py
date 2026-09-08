"""Seeds the two initial users, the Egypt public holiday calendar, and a
starter set of job-role -> category rules. Safe to re-run (idempotent
upserts). Run with: python -m app.seed
"""

from datetime import date

from app.config import get_settings
from app.db import SessionLocal
from app.models import EmployeeCategory, Holiday, JobRoleCategoryRule, User, UserRole
from app.security import hash_password

# Fixed-date holidays are confirmed by Egypt's official calendar. Islamic
# (Hijri) holidays depend on moon sighting and are estimates until confirmed
# closer to the date; they can shift by 1-2 days. Editable afterwards in
# Settings - this is just the starting seed.
EGYPT_HOLIDAYS_2026 = [
    ("2026-01-07", "Coptic Christmas"),
    ("2026-01-25", "January 25 Revolution / Police Day"),
    ("2026-03-20", "Eid al-Fitr (Day 1)"),
    ("2026-03-21", "Eid al-Fitr (Day 2)"),
    ("2026-03-22", "Eid al-Fitr (Day 3)"),
    ("2026-04-12", "Coptic Easter Sunday"),
    ("2026-04-13", "Sham El Nessim"),
    ("2026-04-25", "Sinai Liberation Day"),
    ("2026-05-01", "Labour Day"),
    ("2026-05-26", "Arafat Day"),
    ("2026-05-27", "Eid al-Adha (Day 1)"),
    ("2026-05-28", "Eid al-Adha (Day 2)"),
    ("2026-05-29", "Eid al-Adha (Day 3)"),
    ("2026-06-17", "Islamic New Year"),
    ("2026-06-30", "June 30 Revolution Day"),
    ("2026-07-23", "July 23 Revolution Day"),
    ("2026-08-26", "Prophet Muhammad's Birthday (Mawlid al-Nabi)"),
    ("2026-10-06", "Armed Forces Day"),
]

# Starter job-title -> category mapping. Add rows here (or via Settings)
# whenever a new job title shows up unassigned after a ZenHR sync.
STARTER_CATEGORY_RULES = {
    "General Manager": EmployeeCategory.MANAGEMENT,
    "Branch Manager": EmployeeCategory.MANAGEMENT,
    "Operations Manager": EmployeeCategory.MANAGEMENT,
    "Area Manager": EmployeeCategory.MANAGEMENT,
    "Supervisor": EmployeeCategory.MANAGEMENT,
    "Sales Representative": EmployeeCategory.SALES,
    "Sales Executive": EmployeeCategory.SALES,
    "Sales Support": EmployeeCategory.SALES_SUPPORT,
    "Collector": EmployeeCategory.COLLECTOR,
    "Delivery Agent": EmployeeCategory.DELIVERY_AGENT,
    "Co-Founder": EmployeeCategory.EXCLUDED,
    "HR Consultant": EmployeeCategory.EXCLUDED,
    "Managing Director": EmployeeCategory.EXCLUDED,
    # Exact ZenHR job-title strings observed on real new-hire syncs (rule
    # matching is an exact, case-sensitive dict lookup - see sync.py - so
    # these are kept separate from the title-cased entries above rather
    # than merged into them).
    "Delivery agent": EmployeeCategory.DELIVERY_AGENT,
    "Account Manager": EmployeeCategory.SALES,
    "Key Account Manager": EmployeeCategory.SALES,
    "Senior Account Manager": EmployeeCategory.SALES,
    "Logistics Supervisor": EmployeeCategory.MANAGEMENT,
    "HR Executive": EmployeeCategory.EXCLUDED,
    "office boy": EmployeeCategory.EXCLUDED,
    "office girl": EmployeeCategory.EXCLUDED,
}


def seed_holidays(db) -> None:
    for iso_date, name in EGYPT_HOLIDAYS_2026:
        existing = db.query(Holiday).filter_by(holiday_date=date.fromisoformat(iso_date)).first()
        if existing:
            existing.name = name
        else:
            db.add(Holiday(holiday_date=date.fromisoformat(iso_date), name=name))


def seed_category_rules(db) -> None:
    for job_role, category in STARTER_CATEGORY_RULES.items():
        existing = db.get(JobRoleCategoryRule, job_role)
        if existing:
            existing.category = category
        else:
            db.add(JobRoleCategoryRule(job_role=job_role, category=category))


def seed_users(db) -> None:
    settings = get_settings()
    if not db.query(User).filter_by(email=settings.seed_admin_email).first():
        db.add(
            User(
                email=settings.seed_admin_email,
                password_hash=hash_password(settings.seed_admin_password),
                name=settings.seed_admin_name,
                role=UserRole.ADMIN,
            )
        )


def main() -> None:
    db = SessionLocal()
    try:
        seed_users(db)
        seed_holidays(db)
        seed_category_rules(db)
        db.commit()
        print("Seed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
