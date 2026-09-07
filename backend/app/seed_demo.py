"""Populates a handful of fake employees + attendance/visit/leave/vacation
history so the directory and profile views have something to render
locally, without needing live ZenHR/Bricks credentials. Not run in
production - see README. Run with: python -m app.seed_demo
"""

import random
from datetime import date, datetime, timedelta

from app.db import SessionLocal
from app.models import (
    AttendanceRecord,
    Employee,
    EmployeeCategory,
    LeaveTransaction,
    OnboardingStatus,
    VacationTransaction,
    Visit,
)

DEMO_EMPLOYEES = [
    {"name": "Mona Ibrahim", "title": "Branch Manager", "category": EmployeeCategory.MANAGEMENT},
    {"name": "Tarek Hassan", "title": "Operations Manager", "category": EmployeeCategory.MANAGEMENT},
    {"name": "Youssef Adel", "title": "Sales Representative", "category": EmployeeCategory.SALES},
    {"name": "Karim Ahmed", "title": "Sales Representative", "category": EmployeeCategory.SALES},
    {"name": "Nour Fathy", "title": "Collector", "category": EmployeeCategory.COLLECTOR},
    {"name": "Ahmed Sales-Support", "title": "Sales Support", "category": EmployeeCategory.SALES_SUPPORT},
    {"name": "Sherif Naguib", "title": "Delivery Agent", "category": EmployeeCategory.DELIVERY_AGENT},
    {"name": "Dina Mostafa", "title": "Delivery Agent", "category": EmployeeCategory.DELIVERY_AGENT},
    {"name": "Hana Reda", "title": "Sales Representative", "category": EmployeeCategory.UNASSIGNED},
]

WEEKDAY_OFF = [5, 6]  # Friday, Saturday


def main() -> None:
    db = SessionLocal()
    try:
        for idx, spec in enumerate(DEMO_EMPLOYEES, start=1000):
            existing = db.query(Employee).filter_by(zenhr_employee_id=idx).first()
            if existing:
                continue
            employee = Employee(
                zenhr_employee_id=idx,
                employment_number=str(idx),
                display_name=spec["name"],
                first_name=spec["name"].split()[0],
                last_name=" ".join(spec["name"].split()[1:]),
                job_title=spec["title"],
                category=spec["category"],
                onboarding_status=OnboardingStatus.ACTIVE
                if spec["category"] != EmployeeCategory.UNASSIGNED
                else OnboardingStatus.PENDING_CONFIRMATION,
                active=True,
                hiring_date=date(2024, 1, 15),
                off_weekdays=WEEKDAY_OFF,
                bricks_display_name=spec["name"],
                vacation_balance_days=round(random.uniform(4, 21), 1),
            )
            db.add(employee)
            db.flush()

            today = date.today()
            for days_ago in range(60):
                day = today - timedelta(days=days_ago)
                if day.isoweekday() in WEEKDAY_OFF:
                    continue
                if random.random() < 0.08:
                    status = random.choice(["business_mission", "personal_excuse", "unpaid_leave"])
                    db.add(AttendanceRecord(employee_id=employee.id, attendance_date=day, status=status))
                    continue
                entry = datetime.combine(day, datetime.min.time()) + timedelta(hours=9, minutes=random.randint(-10, 20))
                exit_ = entry + timedelta(hours=8, minutes=random.randint(-15, 45))
                db.add(
                    AttendanceRecord(
                        employee_id=employee.id,
                        attendance_date=day,
                        entry_time=entry,
                        exit_time=exit_,
                        worked_minutes=int((exit_ - entry).total_seconds() / 60),
                        status="present",
                    )
                )

                if spec["category"] in (EmployeeCategory.SALES, EmployeeCategory.COLLECTOR, EmployeeCategory.DELIVERY_AGENT):
                    for _ in range(random.randint(0, 6)):
                        visit_time = entry + timedelta(hours=random.randint(1, 7))
                        db.add(
                            Visit(
                                bricks_visit_id=f"{employee.id}-{day.isoformat()}-{random.randint(0, 9999)}",
                                employee_id=employee.id,
                                owner_bricks_id=f"bricks-{idx}",
                                owner_name_raw=spec["name"],
                                contact_name=random.choice(["Al Salam Market", "Fresh Corner", "City Mart", "Green Grocer"]),
                                is_successful=random.random() > 0.15,
                                is_planned=False,
                                status="completed",
                                visit_time=visit_time,
                            )
                        )

            for _ in range(2):
                leave_day = today - timedelta(days=random.randint(1, 55))
                db.add(
                    LeaveTransaction(
                        employee_id=employee.id,
                        leave_date=leave_day,
                        hours=random.choice([1, 2, 4]),
                        leave_type=random.choice(["personal_excuse", "medical"]),
                        status="Approved",
                    )
                )

            for _ in range(2):
                vac_day = today - timedelta(days=random.randint(1, 55))
                db.add(
                    VacationTransaction(
                        employee_id=employee.id,
                        vacation_date=vac_day,
                        status=random.choice(["Approved", "Added by HR", "Pending"]),
                        vacation_type="Annual",
                    )
                )

        db.commit()
        print("Demo data seeded.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
