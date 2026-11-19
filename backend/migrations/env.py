import os

from alembic import context
from sqlalchemy import create_engine, pool

from app.models import Base

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    # Reihenfolge: explizit gesetzte Option (Tests), Umgebungsvariable, .env über Settings
    url = config.get_main_option("sqlalchemy.url") or os.environ.get("DATABASE_URL")
    if url:
        return url
    from app.config import Settings

    return Settings().database_url  # type: ignore[call-arg]


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    raise SystemExit("Offline-Migrationen werden nicht unterstützt")
run_migrations_online()
