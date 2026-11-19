from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.deps import Principal, get_principal, resolve_access
from app.errors import ApiError

router = APIRouter(tags=["Live"])


def _origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if origin is None:
        return True  # Nicht-Browser-Clients (z. B. Skripte) senden keinen Origin
    if origin in websocket.app.state.settings.allowed_origins:
        return True
    return urlsplit(origin).netloc == websocket.headers.get("host")


@router.websocket("/projects/{project}/ws")
async def project_ws(websocket: WebSocket, project: str) -> None:
    app = websocket.app
    async with app.state.sessionmaker() as db:
        try:
            principal: Principal = await get_principal(websocket, db)
            access = await resolve_access(db, project, principal)
            if principal.token and principal.token.scope != "full":
                raise ApiError(403, "insufficient_scope", "API token scope is not sufficient")
        except ApiError:
            await websocket.close(code=1008)
            return
        project_id = access.project.id
        privileged = access.can_moderate
        # Cookie-authentifizierte Verbindungen nur vom eigenen Origin (Schutz vor CSWSH)
        if principal.via == "session" and not _origin_allowed(websocket):
            await websocket.close(code=1008)
            return

    await websocket.accept()
    conn = app.state.hub.add(project_id, websocket, privileged)
    try:
        while True:
            await websocket.receive_text()  # Client sendet höchstens Pings
    except WebSocketDisconnect:
        pass
    finally:
        app.state.hub.remove(project_id, conn)
