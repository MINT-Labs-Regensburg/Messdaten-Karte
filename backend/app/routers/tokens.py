import uuid
from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import select

from app.deps import DB, SessionPrincipal, require_user
from app.errors import invalid, not_found
from app.models import ApiToken, Project
from app.schemas import ApiTokenCreate, ApiTokenCreated, ApiTokenOut
from app.security import new_api_token
from app.serializers import token_out

router = APIRouter(prefix="/tokens", tags=["Tokens"])


@router.get("", response_model=list[ApiTokenOut])
async def list_tokens(principal: SessionPrincipal, db: DB) -> list[ApiTokenOut]:
    user = require_user(principal)
    tokens = await db.scalars(
        select(ApiToken)
        .where(ApiToken.user_id == user.id, ApiToken.revoked_at.is_(None))
        .order_by(ApiToken.created_at.desc())
    )
    return [token_out(t) for t in tokens]


@router.post("", status_code=201, response_model=ApiTokenCreated)
async def create_token(
    body: ApiTokenCreate, principal: SessionPrincipal, db: DB
) -> ApiTokenCreated:
    user = require_user(principal)
    if body.expires_at is not None and body.expires_at <= datetime.now(UTC):
        raise invalid("expires_in_past", "expires_at must be in the future", "expires_at")
    if body.project_id is not None and await db.get(Project, body.project_id) is None:
        raise invalid("unknown_project", "Project does not exist", "project_id")
    plain, token_hash, prefix = new_api_token()
    token = ApiToken(
        user_id=user.id,
        name=body.name,
        token_hash=token_hash,
        prefix=prefix,
        scope=body.scope,
        project_id=body.project_id,
        expires_at=body.expires_at,
    )
    db.add(token)
    await db.commit()
    return ApiTokenCreated(**token_out(token).model_dump(), token=plain)


@router.delete("/{token_id}", status_code=204)
async def revoke_token(token_id: uuid.UUID, principal: SessionPrincipal, db: DB) -> None:
    user = require_user(principal)
    token = await db.get(ApiToken, token_id)
    if token is None or token.user_id != user.id or token.revoked_at is not None:
        raise not_found("token_not_found", "Token not found")
    token.revoked_at = datetime.now(UTC)
    await db.commit()
