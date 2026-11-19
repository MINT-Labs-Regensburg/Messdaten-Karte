import asyncio
import contextlib
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket

SEND_TIMEOUT_S = 5.0


@dataclass(eq=False)
class Connection:
    ws: WebSocket
    privileged: bool  # Mitglied/Admin: sieht auch Moderationsereignisse


class Hub:
    """Verteilt Live-Ereignisse an die WebSockets eines Projekts (ein Prozess)."""

    def __init__(self) -> None:
        self._rooms: dict[uuid.UUID, set[Connection]] = {}

    def add(self, project_id: uuid.UUID, ws: WebSocket, privileged: bool) -> Connection:
        conn = Connection(ws, privileged)
        self._rooms.setdefault(project_id, set()).add(conn)
        return conn

    def remove(self, project_id: uuid.UUID, conn: Connection) -> None:
        room = self._rooms.get(project_id)
        if room is None:
            return
        room.discard(conn)
        if not room:
            self._rooms.pop(project_id, None)

    def count(self, project_id: uuid.UUID) -> int:
        return len(self._rooms.get(project_id, ()))

    async def publish(
        self,
        project_id: uuid.UUID,
        public: dict[str, Any] | None,
        privileged: dict[str, Any] | None = None,
    ) -> None:
        """Sendet `public` an alle; `privileged` (falls gesetzt) ersetzt es für Mitglieder/Admin."""
        for conn in list(self._rooms.get(project_id, ())):
            message = privileged if (conn.privileged and privileged is not None) else public
            if message is None:
                continue
            try:
                await asyncio.wait_for(conn.ws.send_json(message), SEND_TIMEOUT_S)
            except Exception:  # kaputte Verbindung einfach entfernen
                self.remove(project_id, conn)

    async def close_unprivileged(self, project_id: uuid.UUID) -> None:
        for conn in list(self._rooms.get(project_id, ())):
            if not conn.privileged:
                self.remove(project_id, conn)
                with contextlib.suppress(Exception):
                    await conn.ws.close(code=1008)

    async def close_all(self, project_id: uuid.UUID) -> None:
        for conn in list(self._rooms.get(project_id, ())):
            self.remove(project_id, conn)
            with contextlib.suppress(Exception):
                await conn.ws.close(code=1008)
