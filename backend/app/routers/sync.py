import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import require_admin
from app.models import User
from app.schemas import SyncRunOut
from app.services import zenhr_client
from app.services.sync import run_full_sync

router = APIRouter(prefix="/api/sync", tags=["sync"])

_oauth_states: set[str] = set()


@router.get("/zenhr/connect")
def zenhr_connect(_: User = Depends(require_admin)) -> RedirectResponse:
    state = secrets.token_urlsafe(24)
    _oauth_states.add(state)
    return RedirectResponse(zenhr_client.get_authorize_url(state))


@router.get("/zenhr/callback")
def zenhr_callback(code: str, state: str, db: Session = Depends(get_db)) -> dict:
    if state not in _oauth_states:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired OAuth state")
    _oauth_states.discard(state)
    zenhr_client.exchange_code_for_token(db, code)
    return {"ok": True, "message": "ZenHR connected."}


@router.post("/run", response_model=list[SyncRunOut])
def trigger_sync(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Manual "sync now" trigger, admin-only."""
    return run_full_sync(db)


@router.post("/cron", response_model=list[SyncRunOut])
def cron_sync(request: Request, db: Session = Depends(get_db)):
    """Scheduled-sync trigger, authenticated by a shared secret instead of a
    user session (called by the host's cron, not a browser)."""
    settings = get_settings()
    expected = f"Bearer {settings.sync_cron_secret}"
    if not settings.sync_cron_secret or request.headers.get("authorization") != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unauthorized")
    return run_full_sync(db)


@router.get("/runs", response_model=list[SyncRunOut])
def list_sync_runs(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    from app.models import SyncRun

    return db.query(SyncRun).order_by(SyncRun.started_at.desc()).limit(50).all()
