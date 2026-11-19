import re
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import events
from app.deps import (
    DB,
    Access,
    AccountPrincipal,
    PrincipalAny,
    get_settings,
    require_admin,
    require_user,
)
from app.errors import conflict, forbidden, invalid, unauthorized
from app.models import Measurement, Project, ProjectMember
from app.routers.metrics import build_metric
from app.schemas import ProjectCreate, ProjectDetail, ProjectList, ProjectOut, ProjectUpdate
from app.serializers import project_detail, project_out
from app.services.geo import in_circle

router = APIRouter(prefix="/projects", tags=["Projects"])


_GERMAN = str.maketrans(
    {"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "ae", "Ö": "oe", "Ü": "ue", "ß": "ss"}
)


def slugify(name: str) -> str:
    # Deutsche Umschrift vor der ASCII-Wandlung, sonst fallen ß und Umlaute weg
    text = unicodedata.normalize("NFKD", name.translate(_GERMAN)).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80]
    return text or "projekt"


def _check_slug(slug: str) -> None:
    try:
        uuid.UUID(slug)
    except ValueError:
        return
    raise invalid("invalid_slug", "Slug must not look like a UUID", "slug")


async def unique_slug(db: AsyncSession, base: str) -> str:
    slug, n = base, 1
    while await db.scalar(select(Project.id).where(Project.slug == slug)):
        n += 1
        slug = f"{base}-{n}"
    return slug


def check_radius(radius_m: int, max_radius_m: int) -> None:
    if radius_m > max_radius_m:
        raise invalid("radius_too_large", f"Radius must not exceed {max_radius_m} m", "radius_m")


async def visible_count(db: AsyncSession, project_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(Measurement)
            .where(Measurement.project_id == project_id, Measurement.hidden.is_(False))
        )
        or 0
    )


@router.get("", response_model=ProjectList)
async def list_projects(
    principal: PrincipalAny,
    db: DB,
    scope: Literal["mine", "public", "all"] = "mine",
    archived: bool = False,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> ProjectList:
    user = principal.user
    if principal.token and principal.token.scope != "full":
        raise forbidden("insufficient_scope", "API token scope is not sufficient")
    member_of = (
        select(ProjectMember.project_id).where(ProjectMember.user_id == user.id) if user else None
    )
    if scope == "all":
        if user is None:
            raise unauthorized()
        require_admin(principal)
        cond = None
    elif scope == "public":
        cond = Project.is_public.is_(True)
        if member_of is not None:
            cond = or_(cond, Project.id.in_(member_of))
    else:
        if user is None:
            raise unauthorized()
        cond = Project.id.in_(member_of)
    if principal.token and principal.token.project_id is not None:
        raise forbidden("token_project_restricted", "API token is restricted to one project")

    query = select(Project).where(
        Project.archived_at.is_not(None) if archived else Project.archived_at.is_(None)
    )
    if cond is not None:
        query = query.where(cond)
    total = (await db.scalar(select(func.count()).select_from(query.subquery()))) or 0
    projects = (
        await db.scalars(
            query.order_by(Project.created_at.desc(), Project.id).limit(limit).offset(offset)
        )
    ).all()

    roles: dict[uuid.UUID, str] = {}
    if user and projects:
        rows = await db.execute(
            select(ProjectMember.project_id, ProjectMember.role).where(
                ProjectMember.user_id == user.id,
                ProjectMember.project_id.in_([p.id for p in projects]),
            )
        )
        roles = {pid: role for pid, role in rows}
    counts: dict[uuid.UUID, int] = {}
    if projects:
        rows = await db.execute(
            select(Measurement.project_id, func.count())
            .where(
                Measurement.project_id.in_([p.id for p in projects]),
                Measurement.hidden.is_(False),
            )
            .group_by(Measurement.project_id)
        )
        counts = {pid: n for pid, n in rows}
    return ProjectList(
        items=[project_out(p, roles.get(p.id), counts.get(p.id, 0)) for p in projects],
        total=total,
    )


@router.post("", status_code=201, response_model=ProjectOut)
async def create_project(
    body: ProjectCreate, request: Request, principal: AccountPrincipal, db: DB
) -> ProjectOut:
    user = require_user(principal)
    settings = get_settings(request)
    check_radius(body.radius_m, settings.max_radius_m)
    if body.slug:
        _check_slug(body.slug)
        if await db.scalar(select(Project.id).where(Project.slug == body.slug)):
            raise conflict("slug_taken", "Slug already in use")
        slug = body.slug
    else:
        slug = await unique_slug(db, slugify(body.name))

    project = Project(
        id=uuid.uuid4(),  # vorab, damit die Mitgliedschaft die ID kennt
        slug=slug,
        name=body.name,
        description=body.description,
        center_lat=body.center.lat,
        center_lon=body.center.lon,
        radius_m=body.radius_m,
        is_public=body.is_public,
        is_editable=body.is_editable,
        created_by=user.id,
    )
    project.metrics = [
        build_metric(m, position=m.position if m.position is not None else i)
        for i, m in enumerate(body.metrics)
    ]
    names = [m.name.lower() for m in project.metrics]
    if len(set(names)) != len(names):
        raise conflict("metric_name_taken", "Metric names must be unique")
    db.add(project)
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role="owner"))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise conflict("slug_taken", "Slug already in use") from None
    return project_out(project, "owner", 0)


@router.get("/{project}", response_model=ProjectDetail)
async def get_project(access: Access, db: DB) -> ProjectDetail:
    project = access.project
    first, last = (
        await db.execute(
            select(func.min(Measurement.measured_at), func.max(Measurement.measured_at)).where(
                Measurement.project_id == project.id, Measurement.hidden.is_(False)
            )
        )
    ).one()
    base = project_out(project, access.role, await visible_count(db, project.id))
    return project_detail(project, base, first, last)


@router.patch("/{project}", response_model=ProjectOut)
async def update_project(
    body: ProjectUpdate, request: Request, access: Access, db: DB
) -> ProjectOut:
    access.require_moderator()
    project = access.project
    settings = get_settings(request)
    data = body.model_dump(exclude_unset=True)

    if "slug" in data and data["slug"] != project.slug:
        _check_slug(data["slug"])
        if await db.scalar(select(Project.id).where(Project.slug == data["slug"])):
            raise conflict("slug_taken", "Slug already in use")
        project.slug = data["slug"]
    for field in ("name", "description", "is_public", "is_editable"):
        if field in data:
            setattr(project, field, data[field])

    geometry_changed = False
    if "radius_m" in data:
        check_radius(data["radius_m"], settings.max_radius_m)
        geometry_changed = geometry_changed or data["radius_m"] != project.radius_m
        project.radius_m = data["radius_m"]
    if body.center is not None:
        center = body.center
        geometry_changed = geometry_changed or (
            center.lat != project.center_lat or center.lon != project.center_lon
        )
        project.center_lat, project.center_lon = center.lat, center.lon

    if geometry_changed:
        rows = await db.execute(
            select(Measurement.lat, Measurement.lon).where(Measurement.project_id == project.id)
        )
        if any(
            not in_circle(lat, lon, project.center_lat, project.center_lon, project.radius_m)
            for lat, lon in rows
        ):
            await db.rollback()
            raise conflict(
                "measurements_outside_circle", "Existing measurements lie outside the new circle"
            )
    await db.commit()
    await events.project_updated(request, project)
    return project_out(project, access.role, await visible_count(db, project.id))


@router.delete("/{project}", status_code=204)
async def delete_project(request: Request, access: Access, db: DB) -> None:
    access.require_manager()
    project = access.project
    await db.delete(project)
    await db.commit()
    request.app.state.heatmap_cache.drop_project(project.id)
    await request.app.state.hub.close_all(project.id)


@router.put("/{project}/archive", status_code=204)
async def archive_project(request: Request, access: Access, db: DB) -> None:
    access.require_moderator()
    project = access.project
    if project.archived_at is None:
        project.archived_at = datetime.now(UTC)
        await db.commit()
        await events.project_archived(request, project)


@router.delete("/{project}/archive", status_code=204)
async def unarchive_project(request: Request, access: Access, db: DB) -> None:
    access.require_moderator()
    project = access.project
    if project.archived_at is not None:
        project.archived_at = None
        await db.commit()
        await events.project_updated(request, project)
