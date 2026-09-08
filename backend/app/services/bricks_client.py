"""BricksRep visits API client. Matches the official
`visitslistcount.openapi.json` OpenAPI spec exactly (request shape,
response shape, every field read off a VisitResp) - see
docs/api-endpoint-mapping.md #7. Not yet exercised against the live API,
since BRICKS_API_KEY isn't set in this environment.
"""

from typing import Any

import httpx

from app.config import get_settings


def _headers() -> dict[str, str]:
    settings = get_settings()
    if not settings.bricks_api_key:
        raise RuntimeError("BRICKS_API_KEY is not set")
    return {"Content-Type": "application/json", "X-BRICKS-API-KEY": settings.bricks_api_key}


def _post(path: str, body: dict[str, Any]) -> Any:
    settings = get_settings()
    resp = httpx.post(f"{settings.bricks_base_url}{path}", json=body, headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def list_visits(
    created_from: str,
    created_to: str,
    limit: int = 200,
    offset: int = 0,
    include_planned: bool = False,
) -> list[dict]:
    resp = _post(
        "/api/v1/visits/list",
        {
            "filters": {
                "created_from": created_from,
                "created_to": created_to,
                "include_planned": include_planned,
            },
            "pagination": {"limit": limit, "offset": offset},
            "preloads": {"contact": True},
            "sort": {"sort_key": "visit_time", "sort_direction": "desc"},
        },
    )
    return resp["visits"]


def count_visits(created_from: str, created_to: str) -> int:
    resp = _post(
        "/api/v1/visits/count",
        {"filters": {"created_from": created_from, "created_to": created_to}},
    )
    return resp["count"]
