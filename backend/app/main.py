from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import auth, employees, reports, settings, sync

app = FastAPI(title="Full Stock HR Performance Dashboard")

settings_obj = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings_obj.frontend_origin],
    allow_credentials=True,
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
