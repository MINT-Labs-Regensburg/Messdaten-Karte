"""Interpolation der Messpunkte auf ein Gitter im Projektkreis (Kriging, IDW-Fallback)."""

import asyncio
import math
import time
import uuid
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import numpy as np

from app.services.geo import circle_bounds, to_local_xy

# Aggregation bei vielen Punkten: so viele Zellen entlang des Durchmessers
AGG_CELLS_ACROSS = 30
CHUNK = 2000


@dataclass(frozen=True)
class GridSpec:
    center_lat: float
    center_lon: float
    radius_m: float
    resolution: int
    vmin: float | None  # None = Farbskala aus den Daten
    vmax: float | None
    min_points: int
    max_points: int


def _aggregate(xy: np.ndarray, z: np.ndarray, cell: float) -> tuple[np.ndarray, np.ndarray]:
    """Mittelt Punkte, die in dieselbe Rasterzelle (Kantenlänge `cell` m) fallen."""
    keys = np.floor(xy / cell).astype(np.int64)
    uniq, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = inverse.reshape(-1)
    counts = np.bincount(inverse).astype(float)
    mx = np.bincount(inverse, weights=xy[:, 0]) / counts
    my = np.bincount(inverse, weights=xy[:, 1]) / counts
    mz = np.bincount(inverse, weights=z) / counts
    return np.column_stack([mx, my]), mz


def _idw(xy: np.ndarray, z: np.ndarray, gx: np.ndarray, gy: np.ndarray) -> np.ndarray:
    out = np.empty(len(gx))
    for start in range(0, len(gx), CHUNK):
        sx, sy = gx[start : start + CHUNK], gy[start : start + CHUNK]
        d2 = (sx[:, None] - xy[None, :, 0]) ** 2 + (sy[:, None] - xy[None, :, 1]) ** 2
        w = 1.0 / np.maximum(d2, 1e-6)
        out[start : start + CHUNK] = (w * z[None, :]).sum(axis=1) / w.sum(axis=1)
    return out


def _kriging(
    xy: np.ndarray, z: np.ndarray, gx: np.ndarray, gy: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    from pykrige.ok import OrdinaryKriging

    ok = OrdinaryKriging(
        xy[:, 0],
        xy[:, 1],
        z,
        variogram_model="spherical",
        verbose=False,
        enable_plotting=False,
        coordinates_type="euclidean",
    )
    vals = np.empty(len(gx))
    var = np.empty(len(gx))
    for start in range(0, len(gx), CHUNK):
        v, s = ok.execute("points", gx[start : start + CHUNK], gy[start : start + CHUNK])
        vals[start : start + CHUNK] = np.ma.filled(v, np.nan)
        var[start : start + CHUNK] = np.ma.filled(s, np.nan)
    return vals, var


def compute_grid(points: list[tuple[float, float, float]], spec: GridSpec) -> dict[str, Any]:
    """`points` = (lat, lon, value). Blockierend (CPU) – mit `asyncio.to_thread` aufrufen."""
    base: dict[str, Any] = {"point_count": 0}
    if points:
        arr = np.array(
            [
                (*to_local_xy(lat, lon, spec.center_lat, spec.center_lon), v)
                for lat, lon, v in points
            ]
        )
        # Gleiche Orte (auf 1 m gerundet) mitteln
        xy, z = _aggregate(arr[:, :2], arr[:, 2], 1.0)
        if len(z) > spec.max_points:
            xy, z = _aggregate(xy, z, 2 * spec.radius_m / AGG_CELLS_ACROSS)
        base["point_count"] = len(z)
    else:
        xy, z = np.empty((0, 2)), np.empty(0)

    if len(z) < spec.min_points:
        return {**base, "status": "insufficient_data"}

    n = spec.resolution
    cell = 2 * spec.radius_m / n
    cols = -spec.radius_m + (np.arange(n) + 0.5) * cell
    rows = spec.radius_m - (np.arange(n) + 0.5) * cell  # Nord → Süd
    gx_full, gy_full = np.meshgrid(cols, rows)
    inside = gx_full**2 + gy_full**2 <= spec.radius_m**2
    gx, gy = gx_full[inside], gy_full[inside]

    variance: np.ndarray | None
    if float(np.ptp(z)) == 0.0:
        # Konstante Werte: Kriging ist nicht definiert
        values = np.full(len(gx), float(z[0]))
        variance = np.zeros(len(gx))
        method = "idw_fallback"
    else:
        try:
            values, variance = _kriging(xy, z, gx, gy)
            if not (np.isfinite(values).all() and np.isfinite(variance).all()):
                raise ValueError("non-finite kriging result")
            method = "kriging"
        except Exception:  # Singuläre Matrix, Variogramm-Fit schlägt fehl, ...
            values, variance, method = _idw(xy, z, gx, gy), None, "idw_fallback"

    if spec.vmin is not None and spec.vmax is not None:
        values = np.clip(values, spec.vmin, spec.vmax)

    def to_grid(flat: np.ndarray) -> list[list[float | None]]:
        full = np.full((n, n), np.nan)
        full[inside] = flat
        return [
            [None if math.isnan(x) else round(float(x), 4) for x in row] for row in full.tolist()
        ]

    grid: dict[str, Any] = {"rows": n, "cols": n, "values": to_grid(values)}
    if variance is not None:
        grid["variance"] = to_grid(np.maximum(variance, 0.0))
    return {
        **base,
        "status": "ok",
        "method": method,
        "bounds": circle_bounds(spec.center_lat, spec.center_lon, spec.radius_m),
        "grid": grid,
        "value_range": {"min": spec.vmin, "max": spec.vmax}
        if spec.vmin is not None and spec.vmax is not None
        else {"min": float(values.min()), "max": float(values.max())},
    }


CacheKey = tuple[Any, ...]


class HeatmapCache:
    """Cache mit Entprellung: nach Änderungen höchstens alle `min_interval` s neu rechnen."""

    def __init__(self, size: int, min_interval: float):
        self._size = size
        self._min_interval = min_interval
        self._entries: OrderedDict[CacheKey, tuple[int, float, dict[str, Any]]] = OrderedDict()
        self._versions: dict[uuid.UUID, int] = {}
        self._inflight: dict[CacheKey, asyncio.Task[dict[str, Any]]] = {}

    def invalidate(self, project_id: uuid.UUID) -> None:
        self._versions[project_id] = self._versions.get(project_id, 0) + 1

    def drop_project(self, project_id: uuid.UUID) -> None:
        self._versions.pop(project_id, None)
        for key in [k for k in self._entries if k[0] == project_id]:
            del self._entries[key]

    async def get(
        self,
        project_id: uuid.UUID,
        key: CacheKey,
        compute: Callable[[], Awaitable[dict[str, Any]]],
        timeout: float,
    ) -> dict[str, Any]:
        full_key = (project_id, *key)
        version = self._versions.get(project_id, 0)
        now = time.monotonic()
        entry = self._entries.get(full_key)
        if entry and (entry[0] == version or now - entry[1] < self._min_interval):
            self._entries.move_to_end(full_key)
            return entry[2]

        task = self._inflight.get(full_key)
        if task is None:
            task = asyncio.create_task(self._run(full_key, version, compute))
            self._inflight[full_key] = task
            task.add_done_callback(lambda _t, k=full_key: self._inflight.pop(k, None))
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout)
        except Exception:  # Timeout oder Fehler in der Berechnung
            return {"status": "failed", "point_count": 0}

    async def _run(
        self, full_key: CacheKey, version: int, compute: Callable[[], Awaitable[dict[str, Any]]]
    ) -> dict[str, Any]:
        result = await compute()
        result["computed_at"] = datetime.now(UTC).isoformat()
        self._entries[full_key] = (version, time.monotonic(), result)
        self._entries.move_to_end(full_key)
        while len(self._entries) > self._size:
            self._entries.popitem(last=False)
        return result
