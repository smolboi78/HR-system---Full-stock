from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    jwt_secret: str
    sync_cron_secret: str = ""

    zenhr_base_url: str = "app.zenhr.com"
    zenhr_client_id: str = ""
    zenhr_client_secret: str = ""
    zenhr_redirect_uri: str = ""

    bricks_base_url: str = "https://fullstock.bricks-rep.com"
    bricks_api_key: str = ""

    frontend_origin: str = "http://localhost:5173"

    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = "change-me"
    seed_admin_name: str = "Admin"

    @field_validator("database_url")
    @classmethod
    def _normalize_database_url(cls, v: str) -> str:
        # Railway/Render/Heroku-style Postgres addons hand out
        # "postgres://" or plain "postgresql://" - SQLAlchemy needs the
        # psycopg3 driver spelled out explicitly.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://") :]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
