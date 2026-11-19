from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import Setting


async def registration_enabled(db: AsyncSession, settings: Settings) -> bool:
    row = await db.get(Setting, "registration_enabled")
    return bool(row.value) if row is not None else settings.registration_default


async def set_registration_enabled(db: AsyncSession, value: bool) -> None:
    row = await db.get(Setting, "registration_enabled")
    if row is None:
        db.add(Setting(key="registration_enabled", value=value))
    else:
        row.value = value
    await db.commit()
