"""Hintergrundkarte für den Bildexport: Kacheln laden (mit Cache) und zu einem Bild zusammensetzen.

Die Nutzungsbedingungen der Kachelserver sind zu beachten: gültiger User-Agent (TILE_USER_AGENT),
Zwischenspeicherung, wenige parallele Verbindungen und Quellenangabe im Bild.
"""

import asyncio
import io
import math
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx
from PIL import Image

from app.services.geo import WORLD_M

TILE_SIZE = 256
MAX_ZOOM = 19
MISSING_TILE = (205, 205, 205)


@dataclass(frozen=True)
class TileSource:
    key: str
    url: str
    attribution: str


SOURCES: dict[str, TileSource] = {
    "osm": TileSource(
        "osm",
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "© OpenStreetMap contributors",
    ),
    "satellite": TileSource(
        "satellite",
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    ),
}


@dataclass(frozen=True)
class TilePlan:
    zoom: int
    x0: int
    x1: int  # inklusive
    y0: int
    y1: int  # inklusive

    @property
    def count(self) -> int:
        return (self.x1 - self.x0 + 1) * (self.y1 - self.y0 + 1)

    @property
    def extent(self) -> tuple[float, float, float, float]:
        """Mercator-Ausdehnung des zusammengesetzten Bildes: (links, rechts, unten, oben)."""
        n = 2**self.zoom
        left = self.x0 / n * WORLD_M - WORLD_M / 2
        right = (self.x1 + 1) / n * WORLD_M - WORLD_M / 2
        top = WORLD_M / 2 - self.y0 / n * WORLD_M
        bottom = WORLD_M / 2 - (self.y1 + 1) / n * WORLD_M
        return left, right, bottom, top


def _covering(extent: tuple[float, float, float, float], zoom: int) -> TilePlan:
    x_min, x_max, y_min, y_max = extent
    n = 2**zoom

    def tx(x: float) -> int:
        return min(n - 1, max(0, math.floor((x + WORLD_M / 2) / WORLD_M * n)))

    def ty(y: float) -> int:
        return min(n - 1, max(0, math.floor((WORLD_M / 2 - y) / WORLD_M * n)))

    return TilePlan(zoom, tx(x_min), tx(x_max), ty(y_max), ty(y_min))


def plan_tiles(
    extent: tuple[float, float, float, float], target_px: int, max_tiles: int
) -> TilePlan:
    """Wählt die Zoomstufe, bei der die Kacheln etwa die gewünschte Bildbreite in Originalauflösung
    liefern, und senkt sie, bis höchstens `max_tiles` Kacheln nötig sind."""
    width_m = max(extent[1] - extent[0], 1.0)
    wanted = round(math.log2(max(target_px, TILE_SIZE) * WORLD_M / (TILE_SIZE * width_m)))
    for zoom in range(min(MAX_ZOOM, max(0, wanted)), -1, -1):
        plan = _covering(extent, zoom)
        if plan.count <= max_tiles:
            return plan
    return _covering(extent, 0)


class BasemapUnavailable(Exception):
    """Kein einziges Kachelbild konnte geladen werden."""


@dataclass
class Basemap:
    image: Image.Image
    extent: tuple[float, float, float, float]
    attribution: str


Fetch = Callable[[str], Awaitable[bytes]]


class TileFetcher:
    def __init__(
        self,
        user_agent: str,
        max_tiles: int = 49,
        fetch: Fetch | None = None,
        cache_size: int = 512,
        ttl_s: float = 24 * 3600,
        concurrency: int = 2,
        transport: httpx.AsyncBaseTransport | None = None,
        deadline_s: float = 30.0,
        retries: int = 1,
    ) -> None:
        self._user_agent = user_agent
        self._max_tiles = max_tiles
        self._fetch = fetch or self._http_get
        self._cache: OrderedDict[tuple[str, int, int, int], tuple[float, bytes]] = OrderedDict()
        self._cache_size = cache_size
        self._ttl = ttl_s
        self._limit = asyncio.Semaphore(concurrency)
        self._client: httpx.AsyncClient | None = None
        self._transport = transport
        self._deadline = deadline_s
        self._retries = retries

    async def _http_get(self, url: str) -> bytes:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=6.0,
                follow_redirects=True,
                headers={"User-Agent": self._user_agent},
                transport=self._transport,
            )
        response = await self._client.get(url)
        response.raise_for_status()
        return response.content

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _tile(self, source: TileSource, z: int, x: int, y: int) -> Image.Image | None:
        key = (source.key, z, x, y)
        cached = self._cache.get(key)
        data: bytes | None = None
        if cached and time.monotonic() - cached[0] < self._ttl:
            self._cache.move_to_end(key)
            data = cached[1]
        else:
            for attempt in range(self._retries + 1):
                try:
                    async with self._limit:
                        data = await self._fetch(source.url.format(z=z, x=x, y=y))
                    break
                except Exception:  # Netzwerk, HTTP-Fehler, Zeitüberschreitung
                    if attempt == self._retries:
                        return None  # Kachel bleibt leer
                    await asyncio.sleep(0.3)
            if data is None:
                return None
        try:
            image = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception:  # keine gültige Bilddatei
            return None
        self._cache[key] = (time.monotonic(), data)
        self._cache.move_to_end(key)
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return image

    async def basemap(
        self, source_key: str, extent: tuple[float, float, float, float], target_px: int
    ) -> Basemap:
        source = SOURCES[source_key]
        plan = plan_tiles(extent, target_px, self._max_tiles)
        coords = [(x, y) for y in range(plan.y0, plan.y1 + 1) for x in range(plan.x0, plan.x1 + 1)]
        tasks = [asyncio.create_task(self._tile(source, plan.zoom, x, y)) for x, y in coords]
        # Gesamtlimit: was bis dahin fehlt, bleibt leer (der Export wartet nicht ewig)
        _, pending = await asyncio.wait(tasks, timeout=self._deadline)
        for task in pending:
            task.cancel()
        tiles = [t.result() if t.done() and not t.cancelled() else None for t in tasks]
        if not any(tile is not None for tile in tiles):
            raise BasemapUnavailable(source_key)
        mosaic = Image.new(
            "RGB",
            ((plan.x1 - plan.x0 + 1) * TILE_SIZE, (plan.y1 - plan.y0 + 1) * TILE_SIZE),
            MISSING_TILE,
        )
        for (x, y), tile in zip(coords, tiles, strict=True):
            if tile is not None:
                mosaic.paste(tile, ((x - plan.x0) * TILE_SIZE, (y - plan.y0) * TILE_SIZE))
        return Basemap(mosaic, plan.extent, source.attribution)
