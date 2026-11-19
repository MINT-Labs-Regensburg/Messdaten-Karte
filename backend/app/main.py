import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.errors import register_error_handlers
from app.models import User
from app.routers import (
    admin,
    auth,
    export,
    heatmap,
    live,
    measurements,
    members,
    metrics,
    projects,
    tokens,
)
from app.security import hash_password
from app.services.heatmap import HeatmapCache
from app.services.hub import Hub
from app.services.ratelimit import RateLimiter
from app.services.tiles import TileFetcher


async def bootstrap_admin(app: FastAPI) -> None:
    """Legt den ersten Admin an (ADMIN_USERNAME/ADMIN_PASSWORD), falls er noch fehlt."""
    settings: Settings = app.state.settings
    if not (settings.admin_username and settings.admin_password):
        return
    async with app.state.sessionmaker() as db:
        exists = await db.scalar(
            select(User.id).where(func.lower(User.username) == settings.admin_username.lower())
        )
        if exists:
            return
        password_hash = await asyncio.to_thread(
            hash_password, settings.admin_password, settings.hash_scheme
        )
        db.add(User(username=settings.admin_username, password_hash=password_hash, is_admin=True))
        await db.commit()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()  # type: ignore[call-arg]

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await bootstrap_admin(app)
        yield
        await app.state.tile_fetcher.aclose()
        await app.state.engine.dispose()

    app = FastAPI(title="Messdaten Karte API", version="0.1.0", lifespan=lifespan)
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    app.state.limiter = RateLimiter()
    app.state.hub = Hub()
    app.state.tile_fetcher = TileFetcher(settings.tile_user_agent, settings.export_max_tiles)
    app.state.heatmap_cache = HeatmapCache(
        settings.heatmap_cache_size, settings.heatmap_min_interval_s
    )
    register_error_handlers(app)

    for module in (
        auth,
        projects,
        members,
        metrics,
        measurements,
        heatmap,
        export,
        tokens,
        admin,
        live,
    ):
        app.include_router(module.router, prefix="/api")

    @app.get("/api/health", include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
