import asyncio
import uuid

from fastapi import APIRouter, Query, Request
from sqlalchemy import func, select

from app.deps import DB, AccountPrincipal, get_settings, require_admin
from app.errors import conflict, not_found
from app.models import User
from app.routers.auth import create_user
from app.schemas import AdminUserCreate, AdminUserUpdate, SettingsModel, UserList, UserOut
from app.security import hash_password
from app.serializers import user_out
from app.services import appsettings

router = APIRouter(prefix="/admin", tags=["Admin"])


async def _active_admin_count(db: DB) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.is_admin.is_(True), User.is_active.is_(True))
        )
        or 0
    )


@router.get("/users", response_model=UserList)
async def list_users(
    principal: AccountPrincipal,
    db: DB,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> UserList:
    require_admin(principal)
    query = select(User)
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(User.username.ilike(f"%{escaped}%", escape="\\"))
    total = (await db.scalar(select(func.count()).select_from(query.subquery()))) or 0
    users = await db.scalars(query.order_by(func.lower(User.username)).limit(limit).offset(offset))
    return UserList(items=[user_out(u) for u in users], total=total)


@router.post("/users", status_code=201, response_model=UserOut)
async def create_admin_user(
    body: AdminUserCreate, request: Request, principal: AccountPrincipal, db: DB
) -> UserOut:
    require_admin(principal)
    user = await create_user(db, get_settings(request), body.username, body.password, body.is_admin)
    return user_out(user)


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID, body: AdminUserUpdate, request: Request, principal: AccountPrincipal, db: DB
) -> UserOut:
    require_admin(principal)
    user = await db.get(User, user_id)
    if user is None:
        raise not_found("user_not_found", "User not found")
    data = body.model_dump(exclude_unset=True)
    losing_admin = (
        user.is_admin
        and user.is_active
        and (data.get("is_admin") is False or data.get("is_active") is False)
    )
    if losing_admin and await _active_admin_count(db) <= 1:
        raise conflict("last_admin", "At least one active admin is required")
    if data.get("is_admin") is not None:
        user.is_admin = data["is_admin"]
    if data.get("is_active") is not None:
        user.is_active = data["is_active"]
        if not user.is_active:
            user.session_version += 1
    if body.new_password:
        user.password_hash = await asyncio.to_thread(
            hash_password, body.new_password, get_settings(request).hash_scheme
        )
        user.session_version += 1
    await db.commit()
    return user_out(user)


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: uuid.UUID, principal: AccountPrincipal, db: DB) -> None:
    require_admin(principal)
    user = await db.get(User, user_id)
    if user is None:
        raise not_found("user_not_found", "User not found")
    if user.is_admin and user.is_active and await _active_admin_count(db) <= 1:
        raise conflict("last_admin", "At least one active admin is required")
    await db.delete(user)
    await db.commit()


@router.get("/settings", response_model=SettingsModel)
async def get_admin_settings(
    request: Request, principal: AccountPrincipal, db: DB
) -> SettingsModel:
    require_admin(principal)
    enabled = await appsettings.registration_enabled(db, get_settings(request))
    return SettingsModel(registration_enabled=enabled)


@router.patch("/settings", response_model=SettingsModel)
async def update_admin_settings(
    body: SettingsModel, request: Request, principal: AccountPrincipal, db: DB
) -> SettingsModel:
    require_admin(principal)
    if body.registration_enabled is not None:
        await appsettings.set_registration_enabled(db, body.registration_enabled)
    enabled = await appsettings.registration_enabled(db, get_settings(request))
    return SettingsModel(registration_enabled=enabled)
