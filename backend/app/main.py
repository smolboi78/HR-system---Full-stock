from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, employees, reports, settings, sync

app = FastAPI(title="Full Stock HR Performance Dashboard")

# Auth is a Bearer token the frontend sends explicitly (not a cookie), so
# there's nothing credential-bearing for the browser to protect here -
# any origin can call this API as long as it has a valid token.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(employees.router)
app.include_router(settings.router)
app.include_router(sync.router)
app.include_router(reports.router)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}
