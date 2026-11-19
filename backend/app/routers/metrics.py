import uuid

from fastapi import APIRouter, Request
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app import events
from app.deps import DB, Access
from app.errors import conflict, invalid, not_found
from app.models import Measurement, MeasurementValue, Metric
from app.schemas import DEFAULT_COLOR_SCALE, MetricCreate, MetricOut, MetricUpdate
from app.serializers import metric_out

router = APIRouter(prefix="/projects/{project}/metrics", tags=["Metrics"])


def build_metric(body: MetricCreate, position: int) -> Metric:
    scale = body.color_scale.model_dump(exclude_none=True) or dict(DEFAULT_COLOR_SCALE)
    return Metric(
        name=body.name,
        unit=body.unit,
        type=body.type,
        min=body.min,
        max=body.max,
        color_scale=scale,
        position=position,
    )


async def _get_metric(access, db, metric_id: uuid.UUID) -> Metric:
    metric = await db.get(Metric, metric_id)
    if metric is None or metric.project_id != access.project.id:
        raise not_found("metric_not_found", "Metric not found")
    return metric


@router.get("", response_model=list[MetricOut])
async def list_metrics(access: Access) -> list[MetricOut]:
    return [metric_out(m) for m in access.project.metrics]


@router.post("", status_code=201, response_model=MetricOut)
async def create_metric(body: MetricCreate, request: Request, access: Access, db: DB) -> MetricOut:
    access.require_moderator()
    project = access.project
    if any(m.name.lower() == body.name.lower() for m in project.metrics):
        raise conflict("metric_name_taken", "Metric name already used in this project")
    position = body.position
    if position is None:
        position = max((m.position for m in project.metrics), default=-1) + 1
    metric = build_metric(body, position)
    metric.project_id = project.id
    db.add(metric)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise conflict("metric_name_taken", "Metric name already used in this project") from None
    await db.refresh(project)
    await events.project_updated(request, project)
    return metric_out(metric)


@router.patch("/{metric_id}", response_model=MetricOut)
async def update_metric(
    metric_id: uuid.UUID, body: MetricUpdate, request: Request, access: Access, db: DB
) -> MetricOut:
    access.require_moderator()
    metric = await _get_metric(access, db, metric_id)
    data = body.model_dump(exclude_unset=True)

    new_min = data.get("min", metric.min)
    new_max = data.get("max", metric.max)
    if new_min >= new_max:
        raise invalid("invalid_range", "min must be smaller than max", "min")
    if metric.type == "scale" and (new_min != int(new_min) or new_max != int(new_max)):
        raise invalid("invalid_range", "scale metrics need integer bounds", "min")
    if "min" in data or "max" in data:
        outside = await db.scalar(
            select(func.count())
            .select_from(MeasurementValue)
            .where(
                MeasurementValue.metric_id == metric.id,
                (MeasurementValue.value < new_min) | (MeasurementValue.value > new_max),
            )
        )
        if outside:
            raise conflict("values_out_of_range", "Existing values lie outside the new range")
    if (
        "name" in data
        and data["name"].lower() != metric.name.lower()
        and any(m.name.lower() == data["name"].lower() for m in access.project.metrics)
    ):
        raise conflict("metric_name_taken", "Metric name already used in this project")

    for field in ("name", "unit", "min", "max", "position"):
        if field in data:
            setattr(metric, field, data[field])
    if "color_scale" in data:
        metric.color_scale = body.color_scale.model_dump(exclude_none=True)  # type: ignore[union-attr]
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise conflict("metric_name_taken", "Metric name already used in this project") from None
    await db.refresh(access.project)
    await events.project_updated(request, access.project)
    return metric_out(metric)


@router.delete("/{metric_id}", status_code=204)
async def delete_metric(metric_id: uuid.UUID, request: Request, access: Access, db: DB) -> None:
    access.require_moderator()
    project = access.project
    metric = await _get_metric(access, db, metric_id)

    # Messungen, die danach keinen Wert mehr hätten, werden mitgelöscht.
    affected = select(MeasurementValue.measurement_id).where(
        MeasurementValue.metric_id == metric.id
    )
    empty_ids = (
        await db.scalars(
            select(MeasurementValue.measurement_id)
            .where(MeasurementValue.measurement_id.in_(affected))
            .group_by(MeasurementValue.measurement_id)
            .having(func.count() == 1)
        )
    ).all()
    await db.execute(delete(Measurement).where(Measurement.id.in_(empty_ids)))
    await db.delete(metric)
    await db.commit()
    await db.refresh(project)
    for measurement_id in empty_ids:
        await events.measurement_deleted(request, project.id, measurement_id)
    await events.project_updated(request, project)
