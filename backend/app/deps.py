"""Authentifizierung, Berechtigungen und Projektzugriff als FastAPI-Dependencies."""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import HTTPConnection

from app.config import Settings
from app.errors import ApiError, forbidden, not_found, unauthorized
from app.models import ApiToken, Project, ProjectMember, User
from app.security import (
    SESSION_COOKIE,
    SessionSigner,
    hash_token,
    new_csrf_token,
    now_ts,
    tokens_equal,
)

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
TOKEN_LAST_USED_GRANULARITY = timedelta(minutes=1)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


DB = Annotated[AsyncSession, Depends(get_db)]


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


@dataclass
class Principal:
    user: User | None
    via: Literal["anonymous", "session", "token"] = "anonymous"
    token: ApiToken | None = None
    csrf_token: str | None = None

    @property
    def is_admin(self) -> bool:
        return bool(self.user and self.user.is_admin)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def set_session_cookie(
    response: Response, settings: Settings, user: User, remember: bool, csrf: str | None = None
) -> str:
    signer = SessionSigner(settings.secret_key)
    csrf = csrf or new_csrf_token()
    payload = {
        "uid": str(user.id),
        "ver": user.session_version,
        "csrf": csrf,
        "rem": remember,
        "iat": now_ts(),
    }
    response.set_cookie(
        SESSION_COOKIE,
        signer.dumps(payload),
        max_age=settings.remember_max_age_s if remember else None,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return csrf


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


async def load_session_user(
    cookie: str | None, settings: Settings, db: AsyncSession
) -> tuple[User, dict] | None:
    """Prüft Signatur, Alter, Benutzer und Session-Version. Gibt None für ungültige Sessions."""
    if not cookie:
        return None
    data = SessionSigner(settings.secret_key).loads(cookie, settings.remember_max_age_s)
    if not data:
        return None
    max_age = settings.remember_max_age_s if data.get("rem") else settings.session_max_age_s
    if now_ts() - int(data.get("iat", 0)) > max_age:
        return None
    try:
        user_id = uuid.UUID(str(data.get("uid")))
    except ValueError:
        return None
    user = await db.get(User, user_id)
    if user is None or not user.is_active or user.session_version != data.get("ver"):
        return None
    return user, data


async def get_principal(request: HTTPConnection, db: DB) -> Principal:
    settings: Settings = request.app.state.settings
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        raw = authorization[7:].strip()
        token = await db.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(raw)))
        now = datetime.now(UTC)
        if (
            token is None
            or token.revoked_at is not None
            or (token.expires_at is not None and token.expires_at <= now)
        ):
            raise unauthorized("invalid_token", "Invalid or expired API token")
        user = await db.get(User, token.user_id)
        if user is None or not user.is_active:
            raise unauthorized("invalid_token", "Invalid or expired API token")
        if token.last_used_at is None or now - token.last_used_at > TOKEN_LAST_USED_GRANULARITY:
            token.last_used_at = now
            await db.commit()
        return Principal(user=user, via="token", token=token)

    loaded = await load_session_user(request.cookies.get(SESSION_COOKIE), settings, db)
    if loaded is None:
        return Principal(user=None)
    user, data = loaded
    csrf = str(data.get("csrf", ""))
    if getattr(request, "method", "GET") not in SAFE_METHODS:
        sent = request.headers.get("x-csrf-token", "")
        if not csrf or not sent or not tokens_equal(sent, csrf):
            raise forbidden("csrf_failed", "Missing or invalid CSRF token")
    return Principal(user=user, via="session", csrf_token=csrf)


PrincipalAny = Annotated[Principal, Depends(get_principal)]


async def principal_project(principal: PrincipalAny) -> Principal:
    """Für projektbezogene Endpunkte: API-Tokens brauchen den Scope `full`."""
    if principal.token and principal.token.scope != "full":
        raise forbidden("insufficient_scope", "API token scope is not sufficient")
    return principal


async def principal_account(
    principal: Annotated[Principal, Depends(principal_project)],
) -> Principal:
    """Für kontoweite Endpunkte: zusätzlich dürfen Tokens nicht auf ein Projekt beschränkt sein."""
    if principal.token and principal.token.project_id is not None:
        raise forbidden("token_project_restricted", "API token is restricted to one project")
    return principal


async def principal_session(principal: PrincipalAny) -> Principal:
    if principal.via == "token":
        raise forbidden("session_required", "This endpoint requires a login session")
    if principal.user is None:
        raise unauthorized()
    return principal


ProjectPrincipal = Annotated[Principal, Depends(principal_project)]
AccountPrincipal = Annotated[Principal, Depends(principal_account)]
SessionPrincipal = Annotated[Principal, Depends(principal_session)]


def require_user(principal: Principal) -> User:
    if principal.user is None:
        raise unauthorized()
    return principal.user


def require_admin(principal: Principal) -> User:
    user = require_user(principal)
    if not user.is_admin:
        raise forbidden()
    return user


# ------------------------------------------------------------ Projektzugriff


@dataclass
class ProjectAccess:
    project: Project
    principal: Principal
    role: str | None

    @property
    def is_member(self) -> bool:
        return self.role is not None

    @property
    def can_moderate(self) -> bool:
        """Mitglied oder Admin: Projekt bearbeiten, fremde Messungen verwalten."""
        return self.is_member or self.principal.is_admin

    @property
    def can_manage_members(self) -> bool:
        return self.role == "owner" or self.principal.is_admin

    def require_moderator(self) -> None:
        if self.principal.user is None:
            raise unauthorized()
        if not self.can_moderate:
            raise forbidden()

    def require_manager(self) -> None:
        if self.principal.user is None:
            raise unauthorized()
        if not self.can_manage_members:
            raise forbidden()


async def resolve_project(db: AsyncSession, ref: str) -> Project | None:
    try:
        return await db.get(Project, uuid.UUID(ref))
    except ValueError:
        return await db.scalar(select(Project).where(Project.slug == ref.lower()))


async def resolve_access(db: AsyncSession, ref: str, principal: Principal) -> ProjectAccess:
    project = await resolve_project(db, ref)
    if project is None:
        raise not_found("project_not_found", "Project not found")
    if principal.token and principal.token.project_id not in (None, project.id):
        raise forbidden("token_project_mismatch", "API token is restricted to another project")
    role = None
    if principal.user is not None:
        role = await db.scalar(
            select(ProjectMember.role).where(
                ProjectMember.project_id == project.id, ProjectMember.user_id == principal.user.id
            )
        )
    if not (project.is_public or role is not None or principal.is_admin):
        raise not_found("project_not_found", "Project not found")
    return ProjectAccess(project, principal, role)


async def project_access(project: str, db: DB, principal: ProjectPrincipal) -> ProjectAccess:
    return await resolve_access(db, project, principal)


async def project_access_any_scope(project: str, db: DB, principal: PrincipalAny) -> ProjectAccess:
    """Wie `project_access`, aber auch für Tokens mit Scope `measurements:write`."""
    return await resolve_access(db, project, principal)


Access = Annotated[ProjectAccess, Depends(project_access)]
AccessAnyScope = Annotated[ProjectAccess, Depends(project_access_any_scope)]


def api_error_for_archived() -> ApiError:
    return ApiError(409, "project_archived", "Project is archived")
