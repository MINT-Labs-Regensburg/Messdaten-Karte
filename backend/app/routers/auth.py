import asyncio

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.deps import (
    DB,
    AccountPrincipal,
    PrincipalAny,
    SessionPrincipal,
    clear_session_cookie,
    client_ip,
    get_settings,
    require_user,
    set_session_cookie,
)
from app.errors import ApiError, conflict, forbidden, unauthorized
from app.models import User
from app.schemas import (
    Credentials,
    Limits,
    LoginRequest,
    LoginResponse,
    MeResponse,
    PasswordChange,
    UserOut,
)
from app.security import dummy_verify, hash_password, verify_password
from app.serializers import user_out
from app.services import appsettings

router = APIRouter(tags=["Auth"])


async def create_user(
    db: DB, settings, username: str, password: str, is_admin: bool = False
) -> User:
    exists = await db.scalar(select(User.id).where(func.lower(User.username) == username.lower()))
    if exists:
        raise conflict("username_taken", "Username already taken")
    password_hash = await asyncio.to_thread(hash_password, password, settings.hash_scheme)
    user = User(username=username, password_hash=password_hash, is_admin=is_admin)
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise conflict("username_taken", "Username already taken") from None
    return user


@router.post("/auth/register", status_code=201, response_model=UserOut)
async def register(body: Credentials, request: Request, response: Response, db: DB) -> UserOut:
    settings = get_settings(request)
    limiter = request.app.state.limiter
    ip_key = f"register:{client_ip(request)}"
    limiter.check(ip_key, settings.auth_rate_limit_count, settings.auth_rate_limit_window_s)
    if not await appsettings.registration_enabled(db, settings):
        raise forbidden("registration_disabled", "Registration is disabled")
    user = await create_user(db, settings, body.username, body.password)
    limiter.add(ip_key, settings.auth_rate_limit_window_s)
    set_session_cookie(response, settings, user, remember=False)
    return user_out(user)


@router.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request, response: Response, db: DB) -> LoginResponse:
    settings = get_settings(request)
    limiter = request.app.state.limiter
    window = settings.auth_rate_limit_window_s
    ip_key = f"login:ip:{client_ip(request)}"
    user_key = f"login:user:{body.username.lower()}"
    limiter.check(ip_key, settings.auth_rate_limit_count, window)
    limiter.check(user_key, settings.auth_rate_limit_count, window)

    user = await db.scalar(select(User).where(func.lower(User.username) == body.username.lower()))
    if user is None:
        await asyncio.to_thread(dummy_verify, body.password, settings.hash_scheme)
        ok = False
    else:
        ok = await asyncio.to_thread(verify_password, user.password_hash, body.password)
    if not ok or user is None:
        limiter.add(ip_key, window)
        limiter.add(user_key, window)
        raise unauthorized("invalid_credentials", "Invalid username or password")
    if not user.is_active:
        raise forbidden("account_disabled", "Account is disabled")

    limiter.reset(user_key)
    csrf = set_session_cookie(response, settings, user, remember=body.remember_me)
    return LoginResponse(user=user_out(user), csrf_token=csrf)


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response, principal: SessionPrincipal) -> None:
    clear_session_cookie(response, get_settings(request))


@router.get("/me", response_model=MeResponse)
async def me(request: Request, principal: PrincipalAny, db: DB) -> MeResponse:
    settings = get_settings(request)
    return MeResponse(
        user=user_out(principal.user) if principal.user else None,
        csrf_token=principal.csrf_token,
        registration_enabled=await appsettings.registration_enabled(db, settings),
        limits=Limits(
            max_radius_m=settings.max_radius_m,
            max_measurements_per_project=settings.max_measurements_per_project,
            edit_window_seconds=settings.edit_window_seconds,
        ),
    )


@router.patch("/me", status_code=204)
async def change_password(
    body: PasswordChange, request: Request, response: Response, principal: AccountPrincipal, db: DB
) -> None:
    settings = get_settings(request)
    user = require_user(principal)
    limiter = request.app.state.limiter
    key = f"pwchange:{user.id}"
    limiter.check(key, settings.auth_rate_limit_count, settings.auth_rate_limit_window_s)
    ok = await asyncio.to_thread(verify_password, user.password_hash, body.current_password)
    if not ok:
        limiter.add(key, settings.auth_rate_limit_window_s)
        raise ApiError(401, "invalid_credentials", "Current password is incorrect")
    user.password_hash = await asyncio.to_thread(
        hash_password, body.new_password, settings.hash_scheme
    )
    user.session_version += 1  # alle anderen Sessions ungültig
    await db.commit()
    if principal.via == "session":
        set_session_cookie(response, settings, user, remember=False, csrf=principal.csrf_token)
