import asyncio
import csv
import io
import json
from typing import Any

from fastapi import APIRouter, Request, Response
from sqlalchemy import select

from app.deps import DB, Access
from app.errors import invalid
from app.models import Measurement, MeasurementValue, Metric
from app.routers.heatmap import heatmap_result
from app.schemas import ExportRequest
from app.services.render import describe_range, render_map

router = APIRouter(prefix="/projects/{project}/exports", tags=["Export"])

MEDIA_TYPES = {
    "csv": "text/csv; charset=utf-8",
    "geojson": "application/geo+json",
    "svg": "image/svg+xml",
    "png": "image/png",
    "jpeg": "image/jpeg",
}
DEFAULT_IMAGE_PX = 1600


def _safe_cell(value: Any) -> Any:
    """Schützt vor CSV-Injection (Excel/LibreOffice werten Zellen mit = + - @ als Formel)."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


async def _load_measurements(
    db: DB, access: Access, body: ExportRequest, metrics: list[Metric]
) -> list[Measurement]:
    sel = body.select
    query = select(Measurement).where(Measurement.project_id == access.project.id)
    if not sel.include_hidden:
        query = query.where(Measurement.hidden.is_(False))
    if sel.from_:
        query = query.where(Measurement.measured_at >= sel.from_)
    if sel.to:
        query = query.where(Measurement.measured_at < sel.to)
    ids = [m.id for m in metrics]
    query = query.where(
        Measurement.id.in_(
            select(MeasurementValue.measurement_id).where(MeasurementValue.metric_id.in_(ids))
        )
    )
    return list((await db.scalars(query.order_by(Measurement.measured_at, Measurement.id))).all())


def _to_csv(measurements: list[Measurement], metrics: list[Metric], body: ExportRequest) -> bytes:
    notes = body.select.include_notes_and_names
    out = io.StringIO()
    writer = csv.writer(out)
    header = ["id", "measured_at", "lat", "lon"]
    if notes:
        header += ["author_name", "note"]
    if body.select.include_hidden:
        header.append("hidden")
    header += [_safe_cell(f"{m.name} [{m.unit}]" if m.unit else m.name) for m in metrics]
    writer.writerow(header)
    for m in measurements:
        by_metric = {v.metric_id: v.value for v in m.values}
        row: list[Any] = [str(m.id), m.measured_at.isoformat(), m.lat, m.lon]
        if notes:
            row += [_safe_cell(m.author_name or ""), _safe_cell(m.note or "")]
        if body.select.include_hidden:
            row.append(m.hidden)
        row += [by_metric.get(metric.id, "") for metric in metrics]
        writer.writerow(row)
    return out.getvalue().encode()


def _to_geojson(
    measurements: list[Measurement], metrics: list[Metric], body: ExportRequest
) -> bytes:
    names = {m.id: m.name for m in metrics}
    features = []
    for m in measurements:
        props: dict[str, Any] = {
            "id": str(m.id),
            "measured_at": m.measured_at.isoformat(),
            "values": {names[v.metric_id]: v.value for v in m.values if v.metric_id in names},
        }
        if body.select.include_notes_and_names:
            props["author_name"] = m.author_name
            props["note"] = m.note
        if body.select.include_hidden:
            props["hidden"] = m.hidden
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [m.lon, m.lat]},
                "properties": props,
            }
        )
    return json.dumps({"type": "FeatureCollection", "features": features}).encode()


@router.post("")
async def create_export(body: ExportRequest, request: Request, access: Access, db: DB) -> Response:
    project = access.project
    sel = body.select
    if sel.include_hidden:
        access.require_moderator()
    if sel.from_ and sel.to and sel.from_ >= sel.to:
        raise invalid("invalid_time_range", "from must be before to", "select.from")
    if body.format == "video":
        raise invalid("format_not_supported", "Video export is not available yet", "format")

    by_id = {m.id: m for m in project.metrics}
    if sel.metric_ids:
        unknown = [i for i in sel.metric_ids if i not in by_id]
        if unknown:
            raise invalid(
                "unknown_metric", "Metric does not belong to this project", "select.metric_ids"
            )
        metrics = [by_id[i] for i in dict.fromkeys(sel.metric_ids)]
    else:
        metrics = list(project.metrics)

    if body.format in ("csv", "geojson"):
        measurements = await _load_measurements(db, access, body, metrics)
        data = (_to_csv if body.format == "csv" else _to_geojson)(measurements, metrics, body)
    else:
        data = await _render_image(request, access, db, body, metrics)

    ext = "jpg" if body.format == "jpeg" else body.format
    return Response(
        data,
        media_type=MEDIA_TYPES[body.format],
        headers={"Content-Disposition": f'attachment; filename="{project.slug}.{ext}"'},
    )


async def _render_image(
    request: Request, access: Access, db: DB, body: ExportRequest, metrics: list[Metric]
) -> bytes:
    project, img, sel = access.project, body.image, body.select
    if img.basemap != "none":
        raise invalid(
            "basemap_not_supported",
            "Only basemap 'none' is supported (tile usage terms)",
            "image.basemap",
        )
    metric = (
        next((m for m in project.metrics if m.id == img.metric_id), None) if img.metric_id else None
    )
    if metric is None:
        raise invalid(
            "unknown_metric",
            "image.metric_id must name a metric of this project",
            "image.metric_id",
        )

    heat = await heatmap_result(request, project, metric, sel.from_, sel.to, 100, "metric")
    if heat.get("status") == "failed":
        raise invalid("heatmap_failed", "Heatmap could not be computed", "image.metric_id")

    query = (
        select(Measurement.lat, Measurement.lon, MeasurementValue.value)
        .join(MeasurementValue, MeasurementValue.measurement_id == Measurement.id)
        .where(
            Measurement.project_id == project.id,
            Measurement.hidden.is_(False),
            MeasurementValue.metric_id == metric.id,
        )
    )
    if sel.from_:
        query = query.where(Measurement.measured_at >= sel.from_)
    if sel.to:
        query = query.where(Measurement.measured_at < sel.to)
    points = [(lat, lon, v) for lat, lon, v in (await db.execute(query)).all()]

    width = img.width_px or img.height_px or DEFAULT_IMAGE_PX
    height = img.height_px or img.width_px or DEFAULT_IMAGE_PX
    return await asyncio.to_thread(
        render_map,
        fmt=body.format,
        project=project,
        metric=metric,
        heat=heat,
        points=points,
        time_range=describe_range(sel.from_, sel.to),
        width_px=width,
        height_px=height,
        dpi=img.dpi or 100,
        show_points=img.show_points,
        show_legend=img.show_legend,
    )
