"""Verwaltungsbefehle: `python -m app.cli create-admin <benutzername>`."""

import argparse
import asyncio
import getpass
import os
import sys

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import Settings
from app.models import User
from app.schemas import Credentials
from app.security import hash_password


async def create_admin(username: str, password: str) -> bool:
    settings = Settings()  # type: ignore[call-arg]
    Credentials(username=username, password=password)  # gleiche Regeln wie die API
    engine = create_async_engine(settings.database_url)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            if await db.scalar(
                select(User.id).where(func.lower(User.username) == username.lower())
            ):
                return False
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(password, settings.hash_scheme),
                    is_admin=True,
                )
            )
            await db.commit()
            return True
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    admin = sub.add_parser("create-admin", help="Admin-Benutzer anlegen")
    admin.add_argument("username")
    args = parser.parse_args()

    password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Passwort: ")
    if create_admin_result := asyncio.run(create_admin(args.username, password)):
        print(f"Admin '{args.username}' angelegt.")
    else:
        print(f"Benutzer '{args.username}' existiert bereits.", file=sys.stderr)
        sys.exit(1)
    del create_admin_result


if __name__ == "__main__":
    main()
