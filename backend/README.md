# Messdaten Karte – Backend

FastAPI, SQLAlchemy (async, psycopg3), PostgreSQL 15, Alembic. Fachliche Beschreibung: `../projekt.md`, API: `../openapi.yaml`.

## Entwicklung

```bash
cp .env.example .env            # DATABASE_URL und SECRET_KEY eintragen
uv sync
uv run alembic upgrade head     # Schema anlegen
uv run python -m app.cli create-admin <benutzername>
uv run uvicorn app.main:create_app --factory --reload
```

Interaktive API-Doku unter `/docs`. Alle Einstellungen siehe `app/config.py` (Umgebungsvariablen).

## Tests

```bash
docker compose -f compose.test.yaml up -d --wait   # Wegwerf-Postgres auf 127.0.0.1:55432
uv run ruff format . && uv run ruff check .
uv run pytest
```

Die Tests verweigern jede Datenbank, deren Name nicht auf `_test` endet (`TEST_DATABASE_URL` überschreibt den Standard).
