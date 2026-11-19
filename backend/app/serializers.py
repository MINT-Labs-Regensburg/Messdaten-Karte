from app.models import ApiToken, Measurement, Metric, Project, User
from app.schemas import (
    ApiTokenOut,
    LatLon,
    MeasurementOut,
    MetricOut,
    ProjectDetail,
    ProjectOut,
    UserOut,
    ValueIn,
)


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        is_admin=user.is_admin,
        is_active=user.is_active,
        created_at=user.created_at,
    )


def metric_out(metric: Metric) -> MetricOut:
    return MetricOut(
        id=metric.id,
        name=metric.name,
        unit=metric.unit,
        type=metric.type,  # type: ignore[arg-type]
        min=metric.min,
        max=metric.max,
        color_scale=metric.color_scale,
        position=metric.position,
    )


def project_out(
    project: Project, role: str | None = None, measurement_count: int | None = None
) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        slug=project.slug,
        name=project.name,
        description=project.description,
        center=LatLon(lat=project.center_lat, lon=project.center_lon),
        radius_m=project.radius_m,
        is_public=project.is_public,
        is_editable=project.is_editable,
        archived=project.archived,
        measurement_count=measurement_count,
        my_role=role,  # type: ignore[arg-type]
        created_at=project.created_at,
    )


def project_detail(project: Project, base: ProjectOut, first, last) -> ProjectDetail:
    return ProjectDetail(
        **base.model_dump(),
        metrics=[metric_out(m) for m in project.metrics],
        first_measurement_at=first,
        last_measurement_at=last,
    )


def measurement_out(m: Measurement) -> MeasurementOut:
    return MeasurementOut(
        id=m.id,
        lat=m.lat,
        lon=m.lon,
        measured_at=m.measured_at,
        values=[ValueIn(metric_id=v.metric_id, value=v.value) for v in m.values],
        author_name=m.author_name,
        note=m.note,
        source=m.source,  # type: ignore[arg-type]
        hidden=m.hidden,
    )


def token_out(token: ApiToken) -> ApiTokenOut:
    return ApiTokenOut(
        id=token.id,
        name=token.name,
        scope=token.scope,  # type: ignore[arg-type]
        project_id=token.project_id,
        prefix=token.prefix,
        created_at=token.created_at,
        last_used_at=token.last_used_at,
        expires_at=token.expires_at,
    )
