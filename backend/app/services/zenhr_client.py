"""ZenHR API v3 client.

Endpoint shapes below are confirmed against ZenHR's own published Postman
collection (not guessed) - see docs/api-endpoint-mapping.md for the full
breakdown of what's confirmed vs. still assumed.

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

# Confirmed from a real who_am_i response's token_info.scopes.
SCOPES = "read.branch read.employee read.professional_info read.timeoff read.attendance_record"


def _api_origin() -> str:
    return f"https://{get_settings().zenhr_base_url}"


def get_authorize_url(state: str) -> str:
    settings = get_settings()
    params = {
        "client_id": settings.zenhr_client_id,
        "redirect_uri": settings.zenhr_redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
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


def _get(db: Session, path: str, params: dict[str, Any] | None = None) -> httpx.Response:
    token = _get_valid_access_token(db)
    resp = httpx.get(
        f"{_api_origin()}{path}",
        params=params or {},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp


def _fetch_all_pages(db: Session, path: str, params: dict[str, Any], page_delay_s: float = 0.3) -> list[dict]:
    all_rows: list[dict] = []
    page = 1
    while True:
        resp = _get(db, path, {**params, "page": page, "limit": 200}).json()
        all_rows.extend(resp["data"])
        if page >= resp["pagination"]["total_pages"]:
            break
        page += 1
        time.sleep(page_delay_s)
    return all_rows


# ---------- Company / branches / employee master data ----------


def list_branches(db: Session) -> list[dict]:
    return _fetch_all_pages(db, "/api/v3/branches", {})


def list_employees(db: Session, branch_id: int) -> list[dict]:
    return _fetch_all_pages(db, f"/api/v3/branches/{branch_id}/employees", {})


def list_attendance_records(db: Session, branch_id: int, date_from: str, date_to: str) -> list[dict]:
    return _fetch_all_pages(
        db,
        f"/api/v3/branches/{branch_id}/attendance_records",
        {"filter[attendance_date][from]": date_from, "filter[attendance_date][to]": date_to},
    )


# ---------- Professional data (job title / department / manager) ----------
#
# Confirmed: GET .../employees/{id}/professional_data/active returns the
# employee's CURRENT record directly (no need to filter effective_on/
# expires_on ourselves) - {position: {id,name}, department: {id,name},
# manager: {id,name}, site, section, project, hierarchy_group}. Per-employee
# only - no branch-level bulk endpoint exists for this, so syncing it is
# necessarily one request per employee.


def get_employee_active_professional_data(db: Session, branch_id: int, employee_id: int) -> dict | None:
    try:
        resp = _get(db, f"/api/v3/branches/{branch_id}/employees/{employee_id}/professional_data/active")
    except httpx.HTTPStatusError as err:
        if err.response.status_code == 404:
            return None
        raise
    return resp.json()


# ---------- Timeoff (vacation + leave, unified) ----------
#
# Confirmed: ZenHR doesn't split "vacation" and "leave" the way the original
# spec assumed - both come from one timeoff_transactions endpoint, each row
# referencing a TimeoffType (/timeoffs). class_name "AnnualVacation" is the
# spec's "vacation"; everything else is the spec's "leave". Branch-level
# bulk endpoint exists for transactions (no N+1 needed), each row already
# includes "employee": {"id": ...}.


def list_timeoff_types(db: Session, branch_id: int) -> list[dict]:
    return _fetch_all_pages(db, f"/api/v3/branches/{branch_id}/timeoffs", {})


def list_timeoff_transactions(db: Session, branch_id: int, date_from: str, date_to: str) -> list[dict]:
    return _fetch_all_pages(
        db,
        f"/api/v3/branches/{branch_id}/timeoff_transactions",
        {"filter[from_date][from]": date_from, "filter[to_date][to]": date_to},
    )


# ---------- Shift assignment (per-employee working-day pattern) ----------
#
# Confirmed: two branch-level bulk endpoints, no N+1. list_branch_employee_
# shifts gives {employee: {id}, work_shift: {id}, from_date, to_date} - which
# work_shift covers which date range for which employee. list_work_shifts
# gives each shift's own days_off - a list of ZenHR weekday strings, "0"
# (Sunday) through "6" (Saturday), e.g. ["5", "6"] for a Fri/Sat weekend.


def list_branch_employee_shifts(db: Session, branch_id: int) -> list[dict]:
    return _fetch_all_pages(db, f"/api/v3/branches/{branch_id}/employee_shifts", {})


def list_work_shifts(db: Session, branch_id: int) -> list[dict]:
    return _fetch_all_pages(db, f"/api/v3/branches/{branch_id}/work_shifts", {})


def zenhr_weekday_to_iso(zenhr_day: str | int) -> int:
    """ZenHR: 0=Sunday..6=Saturday (Ruby Date#wday convention, confirmed by
    a Fri/Sat weekend showing up as ["5","6"]). ISO weekday: 1=Monday..
    7=Sunday. Only Sunday (0) actually moves; 1-6 (Mon-Sat) are identical
    in both systems."""
    day = int(zenhr_day)
    return 7 if day == 0 else day
