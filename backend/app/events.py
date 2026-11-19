"""Live-Ereignisse: Heatmap-Cache entwerten und per WebSocket an die Clients des Projekts senden."""

import uuid
from typing import Any

from fastapi import Request

from app.models import Measurement, Project
from app.serializers import measurement_out, project_out
from app.services.heatmap import HeatmapCache
from app.services.hub import Hub


def _hub(request: Request) -> Hub:
    return request.app.state.hub


def _cache(request: Request) -> HeatmapCache:
    return request.app.state.heatmap_cache


def _dump(model: Any) -> Any:
    return model.model_dump(mode="json")


async def measurement_created(request: Request, m: Measurement) -> None:
    _cache(request).invalidate(m.project_id)
    event = {"type": "measurement.created", "measurement": _dump(measurement_out(m))}
    await _hub(request).publish(m.project_id, event)


async def measurement_updated(request: Request, m: Measurement, was_hidden: bool) -> None:
    """Änderung an einer Messung; `was_hidden` ist der Zustand vor der Änderung."""
    _cache(request).invalidate(m.project_id)
    hub = _hub(request)
    out = _dump(measurement_out(m))
    if m.hidden and not was_hidden:
        await hub.publish(
            m.project_id,
            {"type": "measurement.deleted", "measurement_id": str(m.id)},
            {"type": "measurement.hidden", "measurement_id": str(m.id)},
        )
    elif was_hidden and not m.hidden:
        await hub.publish(
            m.project_id,
            {"type": "measurement.created", "measurement": out},
            {"type": "measurement.updated", "measurement": out},
        )
    elif not m.hidden:
        await hub.publish(m.project_id, {"type": "measurement.updated", "measurement": out})
    else:
        # weiterhin ausgeblendet: nur Moderatoren interessiert die Änderung
        await hub.publish(m.project_id, None, {"type": "measurement.updated", "measurement": out})


async def measurement_deleted(
    request: Request, project_id: uuid.UUID, measurement_id: uuid.UUID
) -> None:
    _cache(request).invalidate(project_id)
    await _hub(request).publish(
        project_id, {"type": "measurement.deleted", "measurement_id": str(measurement_id)}
    )


async def project_updated(request: Request, project: Project) -> None:
    _cache(request).invalidate(project.id)
    hub = _hub(request)
    if project.is_public:
        await hub.publish(
            project.id, {"type": "project.updated", "project": _dump(project_out(project))}
        )
    else:
        # Nicht mehr öffentlich: Anonyme/Fremde fliegen raus, Mitglieder bleiben informiert.
        await hub.close_unprivileged(project.id)
        await hub.publish(
            project.id, None, {"type": "project.updated", "project": _dump(project_out(project))}
        )


async def project_archived(request: Request, project: Project) -> None:
    await _hub(request).publish(project.id, {"type": "project.archived"})
