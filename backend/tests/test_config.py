from app.config import DatabaseSettings

DB_URL = "postgresql+psycopg://u:p@localhost:5432/messdaten"


def test_database_url_does_not_need_other_required_settings(tmp_path, monkeypatch):
    """Alembic liest nur DATABASE_URL: eine leere SECRET_KEY-Zeile in .env darf nicht stören."""
    (tmp_path / ".env").write_text(f"DATABASE_URL={DB_URL}\nSECRET_KEY=\n")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    assert DatabaseSettings().database_url == DB_URL
