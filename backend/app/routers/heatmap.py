import asyncio
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from app.deps import DB, Access, get_settings
from app.errors import invalid
from app.models import Measurement, MeasurementValue, Metric, Project
from app.services.heatmap import GridSpec, compute_grid

router = APIRouter(prefix="/projects/{project}/heatmap", tags=["Heatmap"])


async def heatmap_result(
    request: Request,
    project: Project,
    metric_row: Metric,
    from_: datetime | None,
    to: datetime | None,
    resolution: int,
    bounds: str,
) -> dict[str, Any]:
    settings = get_settings(request)
    spec = GridSpec(
        center_lat=project.center_lat,
        center_lon=project.center_lon,
        radius_m=project.radius_m,
        resolution=resolution,
        vmin=metric_row.min if bounds == "metric" else None,
        vmax=metric_row.max if bounds == "metric" else None,
        min_points=settings.heatmap_min_points,
        max_points=settings.heatmap_max_points,
    )

    async def compute() -> dict[str, Any]:
        query = (
            select(Measurement.lat, Measurement.lon, MeasurementValue.value)
            .join(MeasurementValue, MeasurementValue.measurement_id == Measurement.id)
            .where(
                Measurement.project_id == project.id,
                Measurement.hidden.is_(False),
                MeasurementValue.metric_id == metric_row.id,
            )
        )
        if from_:
            query = query.where(Measurement.measured_at >= from_)
        if to:
            query = query.where(Measurement.measured_at < to)
        # Eigene Session: die Berechnung kann den Request überleben (Timeout)
        async with request.app.state.sessionmaker() as session:
            rows = (await session.execute(query)).all()
        points = [(lat, lon, value) for lat, lon, value in rows]
        return await asyncio.to_thread(compute_grid, points, spec)

    key = (
        metric_row.id,
        from_,
        to,
        resolution,
        bounds,
        project.center_lat,
        project.center_lon,
        project.radius_m,
    )
    return await request.app.state.heatmap_cache.get(
        project.id, key, compute, settings.heatmap_timeout_s
    )


@router.get("")
async def get_heatmap(
    request: Request,
    access: Access,
    db: DB,
    metric: uuid.UUID,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: datetime | None = None,
    resolution: int = Query(60, ge=10, le=200),
    bounds: Literal["auto", "metric"] = "auto",
) -> dict[str, Any]:
    metric_row = await db.get(Metric, metric)
    if metric_row is None or metric_row.project_id != access.project.id:
        raise invalid("unknown_metric", "Metric does not belong to this project", "metric")
    if from_ and to and from_ >= to:
        raise invalid("invalid_time_range", "from must be before to", "from")
    result = await heatmap_result(
        request, access.project, metric_row, from_, to, resolution, bounds
    )
    return {
        "metric_id": str(metric_row.id),
        "from": from_.isoformat() if from_ else None,
        "to": to.isoformat() if to else None,
        **result,
    }
