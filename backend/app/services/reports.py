"""Downloadable reports: a lean per-employee report (attendance and
hours/visits only, no leave/vacation detail) and a joint report covering
every employee, each available as Excel and PDF.
"""

import io
from datetime import date

import pandas as pd
from jinja2 import Template
from sqlalchemy.orm import Session

from app.models import AttendanceRecord, Employee, EmployeeCategory
from app.services.metrics import compute_period_summary

try:
    from weasyprint import HTML
except OSError:
    # WeasyPrint needs native Pango/Cairo libs at import time. Its absence
    # (e.g. a slimmer container image) shouldn't break Excel exports.
    HTML = None


def _attendance_rows(db: Session, employee: Employee, start: date, end: date) -> list[dict]:
    records = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.employee_id == employee.id,
            AttendanceRecord.attendance_date >= start,
            AttendanceRecord.attendance_date <= end,
        )
        .order_by(AttendanceRecord.attendance_date)
        .all()
    )
    return [
        {
            "date": r.attendance_date.isoformat(),
            "entry_time": r.entry_time.strftime("%H:%M") if r.entry_time else "",
            "exit_time": r.exit_time.strftime("%H:%M") if r.exit_time else "",
            "hours": round((r.worked_minutes or 0) / 60, 2),
            "status": r.status,
        }
        for r in records
    ]


def employee_report_data(db: Session, employee: Employee, start: date, end: date) -> dict:
    summary = compute_period_summary(db, employee, start, end)
    return {
        "employee": employee,
        "period": f"{start.isoformat()} to {end.isoformat()}",
        "summary": summary,
        "attendance": _attendance_rows(db, employee, start, end),
    }


def employee_report_excel(db: Session, employee: Employee, start: date, end: date) -> bytes:
    data = employee_report_data(db, employee, start, end)
    summary_df = pd.DataFrame(
        [
            {
                "Employee": employee.display_name,
                "Job title": employee.job_title or "",
                "Category": employee.category,
                "Period": data["period"],
                "Hours worked": data["summary"].hours,
                "Visits": data["summary"].visits,
                "Days present": data["summary"].days_present,
                "Days expected": data["summary"].days_expected,
                "Days absent": data["summary"].days_absent,
            }
        ]
    )
    attendance_df = pd.DataFrame(data["attendance"])

    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        summary_df.to_excel(writer, sheet_name="Summary", index=False)
        (attendance_df if not attendance_df.empty else pd.DataFrame(columns=["date", "entry_time", "exit_time", "hours", "status"])).to_excel(
            writer, sheet_name="Attendance", index=False
        )
    return buffer.getvalue()


_EMPLOYEE_PDF_TEMPLATE = Template(
    """
    <html><head><style>
      body { font-family: sans-serif; color: #222; }
      h1 { font-size: 20px; margin-bottom: 0; }
      .meta { color: #666; margin-bottom: 16px; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
      th { background: #f4f4f4; }
      .summary { display: flex; gap: 24px; margin-bottom: 20px; }
      .stat { }
      .stat .value { font-size: 18px; font-weight: bold; }
      .stat .label { font-size: 11px; color: #666; }
    </style></head><body>
      <h1>{{ employee.display_name }}</h1>
      <div class="meta">{{ employee.job_title or "" }} &middot; {{ period }}</div>
      <div class="summary">
        <div class="stat"><div class="value">{{ summary.hours }}</div><div class="label">Hours worked</div></div>
        <div class="stat"><div class="value">{{ summary.visits }}</div><div class="label">Visits</div></div>
        <div class="stat"><div class="value">{{ summary.days_present }}/{{ summary.days_expected }}</div><div class="label">Days present</div></div>
        <div class="stat"><div class="value">{{ summary.days_absent }}</div><div class="label">Days absent</div></div>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Entry</th><th>Exit</th><th>Hours</th><th>Status</th></tr></thead>
        <tbody>
        {% for row in attendance %}
          <tr><td>{{ row.date }}</td><td>{{ row.entry_time }}</td><td>{{ row.exit_time }}</td><td>{{ row.hours }}</td><td>{{ row.status }}</td></tr>
        {% endfor %}
        </tbody>
      </table>
    </body></html>
    """
)


def employee_report_pdf(db: Session, employee: Employee, start: date, end: date) -> bytes:
    if HTML is None:
        raise RuntimeError("PDF export is unavailable - WeasyPrint's native libraries aren't installed.")
    data = employee_report_data(db, employee, start, end)
    html = _EMPLOYEE_PDF_TEMPLATE.render(**data)
    return HTML(string=html).write_pdf()


def joint_report_rows(db: Session, start: date, end: date) -> list[dict]:
    employees = (
        db.query(Employee)
        .filter(Employee.category != EmployeeCategory.EXCLUDED)
        .order_by(Employee.display_name)
        .all()
    )
    rows = []
    for employee in employees:
        summary = compute_period_summary(db, employee, start, end)
        rows.append(
            {
                "Employee": employee.display_name,
                "Job title": employee.job_title or "",
                "Category": employee.category,
                "Hours worked": summary.hours,
                "Visits": summary.visits,
                "Days present": summary.days_present,
                "Days expected": summary.days_expected,
                "Days absent": summary.days_absent,
            }
        )
    return rows


def joint_report_excel(db: Session, start: date, end: date) -> bytes:
    df = pd.DataFrame(joint_report_rows(db, start, end))
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="All employees", index=False)
    return buffer.getvalue()


_JOINT_PDF_TEMPLATE = Template(
    """
    <html><head><style>
      body { font-family: sans-serif; color: #222; }
      h1 { font-size: 20px; margin-bottom: 0; }
      .meta { color: #666; margin-bottom: 16px; }
      table { border-collapse: collapse; width: 100%; font-size: 11px; }
      th, td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; }
      th { background: #f4f4f4; }
    </style></head><body>
      <h1>Full Stock HR - Performance report</h1>
      <div class="meta">{{ period }}</div>
      <table>
        <thead><tr><th>Employee</th><th>Job title</th><th>Category</th><th>Hours</th><th>Visits</th><th>Present</th><th>Expected</th><th>Absent</th></tr></thead>
        <tbody>
        {% for row in rows %}
          <tr>
            <td>{{ row["Employee"] }}</td><td>{{ row["Job title"] }}</td><td>{{ row["Category"] }}</td>
            <td>{{ row["Hours worked"] }}</td><td>{{ row["Visits"] }}</td>
            <td>{{ row["Days present"] }}</td><td>{{ row["Days expected"] }}</td><td>{{ row["Days absent"] }}</td>
          </tr>
        {% endfor %}
        </tbody>
      </table>
    </body></html>
    """
)


def joint_report_pdf(db: Session, start: date, end: date) -> bytes:
    if HTML is None:
        raise RuntimeError("PDF export is unavailable - WeasyPrint's native libraries aren't installed.")
    rows = joint_report_rows(db, start, end)
    html = _JOINT_PDF_TEMPLATE.render(rows=rows, period=f"{start.isoformat()} to {end.isoformat()}")
    return HTML(string=html).write_pdf()
