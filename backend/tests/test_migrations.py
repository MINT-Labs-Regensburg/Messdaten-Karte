from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app.models import Base
from tests.conftest import TEST_DATABASE_URL


def test_migrations_match_models(db):
    """Die Alembic-Migration muss exakt das Schema der ORM-Modelle erzeugen."""
    engine = create_engine(TEST_DATABASE_URL)
    try:
        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    finally:
        engine.dispose()
    assert diff == []
