import os
from contextlib import ExitStack
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from psycopg import sql

from app.config import Settings
from app.main import create_app
from app.models import Base

ROOT = Path(__file__).resolve().parent.parent
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://postgres@localhost:55432/messdaten_test"
)
PASSWORD = "correct-horse-battery"
SAFE = {"GET", "HEAD", "OPTIONS"}
CENTER = {"lat": 49.0134, "lon": 12.1016}


def _libpq_url() -> str:
    return TEST_DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")


@pytest.fixture(scope="session", autouse=True)
def _schema():
    """Frische Test-Datenbank per Alembic-Migration (testet die Migration mit)."""
    name = _libpq_url().rsplit("/", 1)[-1].split("?")[0]
    if not name.endswith("_test"):
        pytest.exit(f"Tests laufen nur gegen eine Datenbank, deren Name auf _test endet ({name})")
    try:
        conn = psycopg.connect(_libpq_url(), autocommit=True)
    except psycopg.OperationalError as exc:
        pytest.exit(
            "Test-Datenbank nicht erreichbar. Starten mit:\n"
            "  docker compose -f compose.test.yaml up -d --wait\n"
            f"({exc})"
        )
    with conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(cfg, "head")


@pytest.fixture
def db(_schema):
    """Synchrone Verbindung für Setup/Prüfungen; leert vor jedem Test alle Tabellen."""
    conn = psycopg.connect(_libpq_url(), autocommit=True)
    tables = sql.SQL(", ").join(sql.Identifier(t.name) for t in Base.metadata.sorted_tables)
    conn.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY CASCADE").format(tables))
    yield conn
    conn.close()


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": TEST_DATABASE_URL,
        "secret_key": "test-secret-key-for-unit-tests-only-0123456789",
        "hash_scheme": "pbkdf2:sha256:1000",
        "heatmap_min_interval_s": 0,
        "anon_rate_limit_count": 1000,
        "auth_rate_limit_count": 1000,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class Actor:
    """Ein Benutzer mit eigener Cookie-Sitzung bzw. API-Token (für Tests mit mehreren Benutzern)."""

    def __init__(self, name: str | None = None):
        self.name = name
        self.cookies: dict[str, str] = {}
        self.csrf: str | None = None
        self.bearer: str | None = None
        self.id: str | None = None


class Api:
    def __init__(self, client: TestClient):
        self.client = client

    def request(
        self,
        method: str,
        path: str,
        as_: Actor | None = None,
        headers: dict[str, str] | None = None,
        csrf: bool = True,
        **kwargs: Any,
    ):
        client = self.client
        client.cookies.clear()
        hdrs = dict(headers or {})
        if as_ is not None:
            for key, value in as_.cookies.items():
                client.cookies.set(key, value)
            if as_.bearer:
                hdrs["Authorization"] = f"Bearer {as_.bearer}"
            elif as_.csrf and csrf and method.upper() not in SAFE:
                hdrs["X-CSRF-Token"] = as_.csrf
        response = client.request(method, "/api" + path, headers=hdrs, **kwargs)
        if as_ is not None:
            for header in response.headers.get_list("set-cookie"):
                cookie = SimpleCookie(header)
                for key, morsel in cookie.items():
                    if morsel.value and morsel["max-age"] != "0":
                        as_.cookies[key] = morsel.value
                    else:
                        as_.cookies.pop(key, None)
        return response

    def get(self, path, as_=None, **kw):
        return self.request("GET", path, as_, **kw)

    def post(self, path, as_=None, **kw):
        return self.request("POST", path, as_, **kw)

    def patch(self, path, as_=None, **kw):
        return self.request("PATCH", path, as_, **kw)

    def put(self, path, as_=None, **kw):
        return self.request("PUT", path, as_, **kw)

    def delete(self, path, as_=None, **kw):
        return self.request("DELETE", path, as_, **kw)

    # ---- Komfort
    def register(self, name: str) -> Actor:
        actor = Actor(name)
        r = self.post("/auth/register", actor, json={"username": name, "password": PASSWORD})
        assert r.status_code == 201, r.text
        actor.id = r.json()["id"]
        actor.csrf = self.get("/me", actor).json()["csrf_token"]
        return actor

    def login(self, name: str, password: str = PASSWORD, remember_me: bool = False) -> Actor:
        actor = Actor(name)
        r = self.post(
            "/auth/login",
            actor,
            json={"username": name, "password": password, "remember_me": remember_me},
        )
        assert r.status_code == 200, r.text
        actor.id = r.json()["user"]["id"]
        actor.csrf = r.json()["csrf_token"]
        return actor

    def project(self, actor: Actor, **overrides: Any) -> dict[str, Any]:
        body: dict[str, Any] = {
            "name": "Testgebiet",
            "center": CENTER,
            "radius_m": 500,
            "is_public": True,
            "is_editable": True,
            "metrics": [
                {"name": "Temperatur", "unit": "°C", "type": "number", "min": -30, "max": 50},
                {"name": "Wohlbefinden", "type": "scale", "min": 1, "max": 10},
            ],
        }
        body.update(overrides)
        r = self.post("/projects", actor, json=body)
        assert r.status_code == 201, r.text
        project = r.json()
        detail = self.get(f"/projects/{project['id']}", actor).json()
        project["metrics"] = {m["name"]: m for m in detail["metrics"]}
        return project

    def measure(self, project: dict[str, Any], actor: Actor | None = None, **overrides: Any):
        temp = project["metrics"]["Temperatur"]["id"]
        body: dict[str, Any] = {
            "lat": CENTER["lat"],
            "lon": CENTER["lon"],
            "values": [{"metric_id": temp, "value": 20.0}],
        }
        body.update(overrides)
        return self.post(f"/projects/{project['id']}/measurements", actor, json=body)


@pytest.fixture
def make_api(db):
    stack = ExitStack()

    def factory(**overrides: Any) -> Api:
        app = create_app(make_settings(**overrides))
        client = stack.enter_context(TestClient(app, base_url="https://testserver"))
        return Api(client)

    yield factory
    stack.close()


@pytest.fixture
def api(make_api) -> Api:
    return make_api()


@pytest.fixture
def alice(api) -> Actor:
    return api.register("alice")


@pytest.fixture
def bob(api) -> Actor:
    return api.register("bob")


@pytest.fixture
def admin(api, db) -> Actor:
    actor = api.register("root")
    db.execute("UPDATE users SET is_admin = true WHERE username = 'root'")
    return actor
