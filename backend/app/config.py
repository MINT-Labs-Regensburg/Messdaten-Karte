from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseSettings(BaseSettings):
    """Nur die Datenbank-URL, z. B. für Alembic (braucht kein SECRET_KEY)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str


class Settings(DatabaseSettings):
    """Konfiguration ausschließlich über Umgebungsvariablen (bzw. `.env`)."""

    secret_key: str = Field(min_length=32)

    # Sessions / Cookies
    cookie_secure: bool = True
    session_max_age_s: int = 12 * 3600
    remember_max_age_s: int = 30 * 24 * 3600
    hash_scheme: str = "scrypt"

    # Limits (siehe projekt.md)
    max_radius_m: int = 5000
    max_measurements_per_project: int = 5000
    edit_window_seconds: int = 900
    registration_default: bool = True

    # Rate-Limits (in-memory, pro Prozess)
    anon_rate_limit_count: int = 30
    anon_rate_limit_window_s: int = 60
    auth_rate_limit_count: int = 10
    auth_rate_limit_window_s: int = 900

    # Heatmap
    heatmap_min_points: int = 4
    heatmap_max_points: int = 700
    heatmap_timeout_s: float = 20.0
    heatmap_min_interval_s: float = 2.0
    heatmap_cache_size: int = 256

    # Erster Admin (optional)
    admin_username: str | None = None
    admin_password: str | None = None

    # Zusätzlich erlaubte Origins für WebSocket-Verbindungen (neben dem Host selbst)
    allowed_origins: list[str] = []
