import base64
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Header, Query, Request
from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app import events
from app.deps import DB, Access, AccessAnyScope, client_ip, get_settings
from app.errors import ApiError, conflict, forbidden, invalid, not_found, unauthorized
from app.models import Measurement, MeasurementValue, Metric, Project
from app.schemas import (
    MeasurementCreate,
    MeasurementCreated,
    MeasurementOut,
    MeasurementPage,
    MeasurementUpdate,
    ValueIn,
)
from app.security import hash_token, new_edit_token, tokens_equal
from app.serializers import measurement_out
from app.services.geo import in_circle

router = APIRouter(prefix="/projects/{project}/measurements", tags=["Measurements"])

EditTokenHeader = Annotated[str | None, Header(alias="X-Edit-Token")]
CLOCK_SKEW = timedelta(minutes=1)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def validate_values(values: list[ValueIn], metrics: list[Metric]) -> None:
    by_id = {m.id: m for m in metrics}
    seen: set[uuid.UUID] = set()
    for i, item in enumerate(values):
        field = f"values.{i}"
        metric = by_id.get(item.metric_id)
        if metric is None:
            raise invalid("unknown_metric", "Metric does not belong to this project", field)
        if item.metric_id in seen:
            raise invalid("duplicate_metric", "Metric given more than once", field)
        seen.add(item.metric_id)
        if not metric.min <= item.value <= metric.max:
            raise invalid(
                "value_out_of_range",
                f"Value must be between {metric.min:g} and {metric.max:g}",
                f"{field}.value",
            )
        if metric.type == "scale" and item.value != int(item.value):
            raise invalid("value_not_integer", "Scale values must be integers", f"{field}.value")


def _check_in_circle(project: Project, lat: float, lon: float) -> None:
    if not in_circle(lat, lon, project.center_lat, project.center_lon, project.radius_m):
        raise invalid("point_outside_circle", "Point lies outside the project circle", "lat")


def _encode_cursor(m: Measurement) -> str:
    return base64.urlsafe_b64encode(f"{m.measured_at.isoformat()}|{m.id}".encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        ts, mid = raw.split("|")
        return _aware(datetime.fromisoformat(ts)), uuid.UUID(mid)
    except ValueError:
        raise invalid("invalid_cursor", "Invalid cursor", "cursor") from None


@router.get("", response_model=MeasurementPage)
async def list_measurements(
    access: Access,
    db: DB,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: datetime | None = None,
    include_hidden: bool = False,
    limit: int = Query(100, ge=1, le=1000),
    cursor: str | None = None,
) -> MeasurementPage:
    if include_hidden:
        access.require_moderator()
    if from_ and to and from_ >= to:
        raise invalid("invalid_time_range", "from must be before to", "from")
    query = select(Measurement).where(Measurement.project_id == access.project.id)
    if not include_hidden:
        query = query.where(Measurement.hidden.is_(False))
    if from_:
        query = query.where(Measurement.measured_at >= from_)
    if to:
        query = query.where(Measurement.measured_at < to)
    if cursor:
        ts, mid = _decode_cursor(cursor)
        query = query.where(tuple_(Measurement.measured_at, Measurement.id) > tuple_(ts, mid))
    rows = (
        await db.scalars(query.order_by(Measurement.measured_at, Measurement.id).limit(limit + 1))
    ).all()
    page = rows[:limit]
    return MeasurementPage(
        items=[measurement_out(m) for m in page],
        next_cursor=_encode_cursor(page[-1]) if len(rows) > limit else None,
    )


@router.post("", status_code=201, response_model=MeasurementCreated)
async def create_measurement(
    body: MeasurementCreate, request: Request, access: AccessAnyScope, db: DB
) -> MeasurementCreated:
    settings = get_settings(request)
    principal, project = access.principal, access.project

    if not (access.can_moderate or (project.is_public and project.is_editable)):
        raise forbidden("project_not_editable", "Project does not accept measurements from you")
    if project.archived:
        raise ApiError(409, "project_archived", "Project is archived")
    if principal.user is None:
        request.app.state.limiter.hit(
            f"anon-measurement:{client_ip(request)}",
            settings.anon_rate_limit_count,
            settings.anon_rate_limit_window_s,
        )

    now = datetime.now(UTC)
    measured_at = now
    if body.measured_at is not None:
        if principal.token is None:
            raise invalid(
                "measured_at_not_allowed",
                "measured_at is only allowed with an API token",
                "measured_at",
            )
        measured_at = _aware(body.measured_at)
        if measured_at > now + CLOCK_SKEW:
            raise invalid(
                "measured_at_in_future", "measured_at must not be in the future", "measured_at"
            )

    _check_in_circle(project, body.lat, body.lon)
    validate_values(body.values, project.metrics)

    # Projektzeile sperren, damit das Limit auch bei parallelen Requests hält.
    await db.execute(select(Project.id).where(Project.id == project.id).with_for_update())
    count = await db.scalar(
        select(func.count()).select_from(Measurement).where(Measurement.project_id == project.id)
    )
    if (count or 0) >= settings.max_measurements_per_project:
        await db.rollback()
        raise conflict("measurement_limit_reached", "Measurement limit of this project reached")

    edit_token = edit_hash = None
    if principal.user is None:
        edit_token, edit_hash = new_edit_token()
    measurement = Measurement(
        project_id=project.id,
        lat=body.lat,
        lon=body.lon,
        measured_at=measured_at,
        author_name=body.author_name,
        note=body.note,
        source="api_token" if principal.token else ("user" if principal.user else "anonymous"),
        author_user_id=principal.user.id if principal.user else None,
        api_token_id=principal.token.id if principal.token else None,
        edit_token_hash=edit_hash,
        values=[MeasurementValue(metric_id=v.metric_id, value=v.value) for v in body.values],
    )
    db.add(measurement)
    await db.commit()
    await events.measurement_created(request, measurement)

    created = MeasurementCreated(**measurement_out(measurement).model_dump())
    if edit_token:
        created.edit_token = edit_token
        created.edit_expires_at = _aware(measurement.created_at) + timedelta(
            seconds=settings.edit_window_seconds
        )
    return created


async def _load_for_change(
    request: Request,
    access: Access,
    db: AsyncSession,
    measurement_id: uuid.UUID,
    edit_token: str | None,
) -> Measurement:
    """Lädt die Messung und prüft, ob der Aufrufer sie ändern/löschen darf."""
    settings = get_settings(request)
    measurement = await db.get(Measurement, measurement_id)
    if (
        measurement is None
        or measurement.project_id != access.project.id
        or (measurement.hidden and not access.can_moderate)
    ):
        raise not_found("measurement_not_found", "Measurement not found")

    principal = access.principal
    allowed = access.can_moderate or (
        principal.user is not None and measurement.author_user_id == principal.user.id
    )
    if not allowed:
        if edit_token and measurement.edit_token_hash:
            if not tokens_equal(hash_token(edit_token), measurement.edit_token_hash):
                raise forbidden()
            expires = _aware(measurement.created_at) + timedelta(
                seconds=settings.edit_window_seconds
            )
            if datetime.now(UTC) > expires:
                raise forbidden("edit_window_expired", "The edit window has expired")
        elif principal.user is None and not edit_token:
            raise unauthorized()
        else:
            raise forbidden()
    if access.project.archived:
        raise ApiError(409, "project_archived", "Project is archived")
    return measurement


@router.patch("/{measurement_id}", response_model=MeasurementOut)
async def update_measurement(
    measurement_id: uuid.UUID,
    body: MeasurementUpdate,
    request: Request,
    access: Access,
    db: DB,
    x_edit_token: EditTokenHeader = None,
) -> MeasurementOut:
    measurement = await _load_for_change(request, access, db, measurement_id, x_edit_token)
    data = body.model_dump(exclude_unset=True)
    if "hidden" in data and not access.can_moderate:
        raise forbidden("hide_not_allowed", "Only project members can hide measurements")
    was_hidden = measurement.hidden

    if body.values is not None:
        validate_values(body.values, access.project.metrics)
        measurement.values = [
            MeasurementValue(metric_id=v.metric_id, value=v.value) for v in body.values
        ]
    for field in ("author_name", "note", "hidden"):
        if field in data:
            setattr(measurement, field, data[field])
    await db.commit()
    await db.refresh(measurement)
    await events.measurement_updated(request, measurement, was_hidden)
    return measurement_out(measurement)


@router.delete("/{measurement_id}", status_code=204)
async def delete_measurement(
    measurement_id: uuid.UUID,
    request: Request,
    access: Access,
    db: DB,
    x_edit_token: EditTokenHeader = None,
) -> None:
    measurement = await _load_for_change(request, access, db, measurement_id, x_edit_token)
    was_hidden = measurement.hidden
    await db.delete(measurement)
    await db.commit()
    if was_hidden:
        # Außenstehende kennen die Messung nicht mehr; Moderatoren erfahren vom Löschen.
        await request.app.state.hub.publish(
            access.project.id,
            None,
            {"type": "measurement.deleted", "measurement_id": str(measurement_id)},
        )
        request.app.state.heatmap_cache.invalidate(access.project.id)
    else:
        await events.measurement_deleted(request, access.project.id, measurement_id)
