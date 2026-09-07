"""ZenHR API v3 client.

Status of each endpoint used here is tracked in
docs/api-endpoint-mapping.md - short version: employee list and attendance
records are carried over from a prior build and only partially confirmed
(job title field name is a guess); leave-by-hour, vacation-by-day/balances,
and shift-assignment (per-employee working days) have NO confirmed endpoint
yet and the functions below are best-effort placeholders that raise
NotImplementedError until a real endpoint is confirmed - see the docstring
on each.

Auth model: OAuth 2.0 authorization_code grant for the one-time bootstrap,
then refresh_token grant afterwards.
"""

import time
from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ZenhrOAuthToken

EXPIRY_BUFFER_SECONDS = 60


def _api_origin() -> str:
    return f"https://{get_settings().zenhr_base_url}"


def get_authorize_url(state: str) -> str:
    settings = get_settings()
    params = {
        "client_id": settings.zenhr_client_id,
        "redirect_uri": settings.zenhr_redirect_uri,
        "response_type": "code",
        "scope": "read:employee read:branch read:attendance_record",
        "state": state,
    }
    query = httpx.QueryParams(params)
    return f"{_api_origin()}/oauth/authorize?{query}"


def _request_token(body: dict[str, str]) -> dict[str, Any]:
    resp = httpx.post(f"{_api_origin()}/oauth/token", data=body, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _save_token(db: Session, token: dict[str, Any]) -> None:
    expires_at = datetime.utcnow() + timedelta(seconds=token["expires_in"])
    row = db.get(ZenhrOAuthToken, "default")
    if not row:
        row = ZenhrOAuthToken(id="default")
        db.add(row)
    row.access_token = token["access_token"]
    row.refresh_token = token["refresh_token"]
    row.expires_at = expires_at
    row.scope = token.get("scope", "")
    db.commit()


def exchange_code_for_token(db: Session, code: str) -> None:
    settings = get_settings()
    token = _request_token(
        {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": settings.zenhr_client_id,
            "client_secret": settings.zenhr_client_secret,
            "redirect_uri": settings.zenhr_redirect_uri,
        }
    )
    _save_token(db, token)


def _refresh_token(db: Session, refresh_token: str) -> str:
    settings = get_settings()
    token = _request_token(
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": settings.zenhr_client_id,
            "client_secret": settings.zenhr_client_secret,
        }
    )
    _save_token(db, token)
    return token["access_token"]


def _get_valid_access_token(db: Session) -> str:
    row = db.get(ZenhrOAuthToken, "default")
    if not row:
        raise RuntimeError("ZenHR is not connected yet - complete the OAuth connect flow first.")
    if row.expires_at > datetime.utcnow() + timedelta(seconds=EXPIRY_BUFFER_SECONDS):
        return row.access_token
    return _refresh_token(db, row.refresh_token)


def _get(db: Session, path: str, params: dict[str, Any] | None = None) -> Any:
    token = _get_valid_access_token(db)
    resp = httpx.get(
        f"{_api_origin()}{path}",
        params=params or {},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _fetch_all_pages(db: Session, path: str, params: dict[str, Any], page_delay_s: float = 0.3) -> list[dict]:
    all_rows: list[dict] = []
    page = 1
    while True:
        resp = _get(db, path, {**params, "page": page, "limit": 200})
        all_rows.extend(resp["data"])
        if page >= resp["pagination"]["total_pages"]:
            break
        page += 1
        time.sleep(page_delay_s)
    return all_rows


# ---------- Confirmed-ish endpoints (carried over from the prior build) ----------


def list_branches(db: Session) -> list[dict]:
    return _fetch_all_pages(db, "/api/v3/branches", {})


def list_employees(db: Session, branch_id: int) -> list[dict]:
    return _fetch_all_pages(db, f"/api/v3/branches/{branch_id}/employees", {})


JOB_ROLE_FIELD_CANDIDATES = ("job_title", "position", "job_position")


def extract_job_role(emp: dict) -> str | None:
    """Tries every candidate field name seen in other ZenHR integrations.
    UNCONFIRMED - update once a real employee response has been inspected;
    see docs/api-endpoint-mapping.md #1."""
    for field in JOB_ROLE_FIELD_CANDIDATES:
        value = emp.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, dict):
            name = (value.get("name") or {}).get("en")
            if name:
                return name.strip()
    return None


def list_attendance_records(db: Session, branch_id: int, date_from: str, date_to: str) -> list[dict]:
    """Pulls ZenHR's attendance_records endpoint. NEEDS RE-CHECK against the
    actual accumulative attendance report the spec asks for (business
    mission / personal excuse / uncompleted shift / unpaid leave as distinct
    reasons) - see docs/api-endpoint-mapping.md #2."""
    return _fetch_all_pages(
        db,
        f"/api/v3/branches/{branch_id}/attendance_records",
        {"filter[attendance_date][from]": date_from, "filter[attendance_date][to]": date_to},
    )


# ---------- Unconfirmed endpoints - see docs/api-endpoint-mapping.md ----------


def list_leave_transactions(db: Session, branch_id: int, date_from: str, date_to: str) -> list[dict]:
    """Leave-by-hour transactions. No endpoint confirmed yet (#3 in the
    mapping doc) - raises until one is."""
    raise NotImplementedError(
        "ZenHR leave-by-hour endpoint is not confirmed yet - see docs/api-endpoint-mapping.md #3"
    )


def list_vacation_transactions(db: Session, branch_id: int, date_from: str, date_to: str) -> list[dict]:
    """Vacation-by-day transactions. No endpoint confirmed yet (#4 in the
    mapping doc) - raises until one is."""
    raise NotImplementedError(
        "ZenHR vacation-by-day endpoint is not confirmed yet - see docs/api-endpoint-mapping.md #4"
    )


def get_vacation_balance(db: Session, employee_id: int) -> float:
    """Live vacation balance. No endpoint confirmed yet (#4 in the mapping
    doc) - raises until one is."""
    raise NotImplementedError(
        "ZenHR vacation balance endpoint is not confirmed yet - see docs/api-endpoint-mapping.md #4"
    )


def get_shift_off_weekdays(db: Session, employee_id: int) -> list[int]:
    """Per-employee working-day pattern (ISO weekday numbers that are off)
    from the employee's ZenHR shift assignment. No endpoint confirmed yet
    (#5 in the mapping doc) - raises until one is."""
    raise NotImplementedError(
        "ZenHR shift assignment endpoint is not confirmed yet - see docs/api-endpoint-mapping.md #5"
    )
