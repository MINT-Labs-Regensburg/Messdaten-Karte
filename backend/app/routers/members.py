import uuid

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.deps import DB, Access
from app.errors import conflict, not_found
from app.models import ProjectMember, User
from app.schemas import MemberAdd, MemberOut, MemberRoleUpdate

router = APIRouter(prefix="/projects/{project}/members", tags=["Members"])


async def _owner_count(db: DB, project_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(ProjectMember)
            .where(ProjectMember.project_id == project_id, ProjectMember.role == "owner")
        )
        or 0
    )


@router.get("", response_model=list[MemberOut])
async def list_members(access: Access, db: DB) -> list[MemberOut]:
    access.require_moderator()
    rows = await db.execute(
        select(ProjectMember.user_id, User.username, ProjectMember.role)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == access.project.id)
        .order_by(ProjectMember.role.desc(), User.username)
    )
    return [MemberOut(user_id=uid, username=name, role=role) for uid, name, role in rows]


@router.post("", status_code=201, response_model=MemberOut)
async def add_member(body: MemberAdd, access: Access, db: DB) -> MemberOut:
    access.require_manager()
    user = await db.scalar(select(User).where(func.lower(User.username) == body.username.lower()))
    if user is None:
        raise not_found("user_not_found", "User not found")
    if await db.get(ProjectMember, (access.project.id, user.id)):
        raise conflict("already_member", "User is already a member")
    db.add(ProjectMember(project_id=access.project.id, user_id=user.id, role=body.role))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise conflict("already_member", "User is already a member") from None
    return MemberOut(user_id=user.id, username=user.username, role=body.role)


@router.patch("/{user_id}", response_model=MemberOut)
async def change_role(
    user_id: uuid.UUID, body: MemberRoleUpdate, access: Access, db: DB
) -> MemberOut:
    access.require_manager()
    member = await db.get(ProjectMember, (access.project.id, user_id))
    if member is None:
        raise not_found("member_not_found", "Member not found")
    if (
        member.role == "owner"
        and body.role != "owner"
        and await _owner_count(db, access.project.id) <= 1
    ):
        raise conflict("last_owner", "A project needs at least one owner")
    member.role = body.role
    await db.commit()
    user = await db.get(User, user_id)
    return MemberOut(user_id=user_id, username=user.username, role=member.role)  # type: ignore[union-attr,arg-type]


@router.delete("/{user_id}", status_code=204)
async def remove_member(user_id: uuid.UUID, access: Access, db: DB) -> None:
    access.require_manager()
    member = await db.get(ProjectMember, (access.project.id, user_id))
    if member is None:
        raise not_found("member_not_found", "Member not found")
    if member.role == "owner" and await _owner_count(db, access.project.id) <= 1:
        raise conflict("last_owner", "A project needs at least one owner")
    await db.delete(member)
    await db.commit()
