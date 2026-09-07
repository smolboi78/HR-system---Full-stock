from fastapi import Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User, UserRole
from app.security import decode_access_token


def get_current_user(
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> User:
    # Normal API calls send the token as an Authorization header. A few
    # endpoints (report downloads, the ZenHR OAuth connect redirect) are
    # plain browser navigations that can't attach custom headers, so those
    # pass it as a query param instead - see api/client.ts's authedUrl().
    bearer_token = authorization.removeprefix("Bearer ").strip() if authorization else None
    resolved_token = bearer_token or token
    if not resolved_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    user_id = decode_access_token(resolved_token)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")
    user = db.get(User, user_id)
    if not user or not user.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user
