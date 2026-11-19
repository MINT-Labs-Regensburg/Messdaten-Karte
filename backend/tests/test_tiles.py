import io

import httpx
import pytest
from PIL import Image

from app.services.geo import WORLD_M, lonlat_to_mercator, map_extent
from app.services.tiles import (
    SOURCES,
    TILE_SIZE,
    BasemapUnavailable,
    TileFetcher,
    plan_tiles,
)

pytestmark = pytest.mark.anyio  # async-Tests über das anyio-Plugin (kein pytest-asyncio nötig)

EXTENT = map_extent(49.0134, 12.1016, 400)  # Kreis mit 400 m Radius
BIG = map_extent(49.0134, 12.1016, 5000)


def png(color=(10, 200, 10)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (TILE_SIZE, TILE_SIZE), color).save(buffer, format="PNG")
    return buffer.getvalue()


def test_mercator_roundtrip_of_the_center_and_extent_is_square_and_centered():
    cx, cy = lonlat_to_mercator(49.0134, 12.1016)
    x0, x1, y0, y1 = EXTENT
    assert (x0 + x1) / 2 == pytest.approx(cx) and (y0 + y1) / 2 == pytest.approx(cy)
    assert x1 - x0 == pytest.approx(y1 - y0)
    # Mercator streckt bei 49° Breite um 1/cos(49°) ≈ 1,52; 400 m Radius + 8 % Rand
    assert (x1 - x0) / 2 == pytest.approx(400 * 1.08 / 0.6561, rel=0.01)


def test_plan_covers_the_extent_and_respects_the_tile_limit():
    plan = plan_tiles(EXTENT, 1600, max_tiles=49)
    left, right, bottom, top = plan.extent
    x0, x1, y0, y1 = EXTENT
    assert left <= x0 and right >= x1 and bottom <= y0 and top >= y1
    assert plan.count <= 49 and plan.zoom <= 19

    huge = plan_tiles(BIG, 8000, max_tiles=49)
    assert huge.count <= 49
    tiny = plan_tiles(BIG, 8000, max_tiles=4)
    assert tiny.count <= 4 and tiny.zoom < huge.zoom


def test_smaller_images_use_a_lower_zoom_than_large_ones():
    assert plan_tiles(EXTENT, 300, 49).zoom < plan_tiles(EXTENT, 1600, 49).zoom


def test_plan_extent_is_aligned_with_the_world_grid():
    plan = plan_tiles(EXTENT, 1000, 49)
    tile_m = WORLD_M / 2**plan.zoom
    left, right, _, _ = plan.extent
    assert (right - left) / tile_m == pytest.approx(plan.x1 - plan.x0 + 1)
    assert (left + WORLD_M / 2) / tile_m == pytest.approx(plan.x0)


async def test_mosaic_has_the_expected_size_and_reuses_cached_tiles():
    calls: list[str] = []

    async def fetch(url: str) -> bytes:
        calls.append(url)
        return png()

    fetcher = TileFetcher("test", fetch=fetch)
    base = await fetcher.basemap("osm", EXTENT, 800)
    plan = plan_tiles(EXTENT, 800, 49)
    assert base.image.size == (
        (plan.x1 - plan.x0 + 1) * TILE_SIZE,
        (plan.y1 - plan.y0 + 1) * TILE_SIZE,
    )
    assert base.extent == plan.extent
    assert "OpenStreetMap" in base.attribution
    first = len(calls)
    assert first == plan.count and all(
        u.startswith("https://tile.openstreetmap.org/") for u in calls
    )

    await fetcher.basemap("osm", EXTENT, 800)
    assert len(calls) == first  # zweiter Export holt nichts erneut (Cache)


async def test_each_source_has_its_own_cache_and_attribution():
    urls: list[str] = []

    async def fetch(url: str) -> bytes:
        urls.append(url)
        return png()

    fetcher = TileFetcher("test", fetch=fetch)
    osm = await fetcher.basemap("osm", EXTENT, 500)
    sat = await fetcher.basemap("satellite", EXTENT, 500)
    assert "Esri" in sat.attribution and osm.attribution != sat.attribution
    assert any("arcgisonline.com" in u for u in urls) and any(
        "openstreetmap.org" in u for u in urls
    )
    assert set(SOURCES) == {"osm", "satellite"}


async def test_partial_failures_leave_gray_gaps_but_still_produce_a_map():
    async def fetch(url: str) -> bytes:
        if (
            int(url.rsplit("/", 1)[-1].split(".")[0]) % 2 == 0
        ):  # jede zweite Kachelzeile ist dauerhaft kaputt
            raise RuntimeError("Zeitüberschreitung")
        return png((0, 0, 255))

    base = await TileFetcher("test", fetch=fetch, retries=0).basemap("osm", EXTENT, 800)
    colors = {c for _, c in base.image.getcolors(maxcolors=10)}
    assert (0, 0, 255) in colors and (205, 205, 205) in colors


async def test_a_failed_tile_is_retried_once():
    attempts: dict[str, int] = {}

    async def flaky(url: str) -> bytes:
        attempts[url] = attempts.get(url, 0) + 1
        if attempts[url] == 1:
            raise RuntimeError("kurzer Aussetzer")
        return png()

    base = await TileFetcher("test", fetch=flaky).basemap("osm", EXTENT, 500)
    assert all(n == 2 for n in attempts.values())  # genau ein zweiter Versuch je Kachel
    assert {c for _, c in base.image.getcolors(maxcolors=10)} == {
        (10, 200, 10)
    }  # keine grauen Lücken


async def test_the_overall_deadline_keeps_a_slow_server_from_blocking_the_export():
    import asyncio

    async def slow(url: str) -> bytes:
        if url.endswith("/0.png") or int(url.rsplit("/", 1)[-1].split(".")[0]) % 2 == 0:
            await asyncio.sleep(30)  # hängt
        return png()

    base = await TileFetcher("test", fetch=slow, deadline_s=0.3, retries=0).basemap(
        "osm", EXTENT, 800
    )
    colors = {c for _, c in base.image.getcolors(maxcolors=10)}
    assert (205, 205, 205) in colors and (10, 200, 10) in colors  # hängende Kacheln bleiben leer


async def test_unreachable_server_or_garbage_means_no_basemap():
    async def down(url: str) -> bytes:
        raise RuntimeError("offline")

    async def garbage(url: str) -> bytes:
        return b"<html>kein Bild</html>"

    for fetch in (down, garbage):
        with pytest.raises(BasemapUnavailable):
            await TileFetcher("test", fetch=fetch).basemap("osm", EXTENT, 500)


async def test_http_client_sends_the_configured_user_agent():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=png()) if len(seen) > 1 else httpx.Response(404)

    fetcher = TileFetcher(
        "Meine-Instanz/1.0 (admin@example.org)", transport=httpx.MockTransport(handler)
    )
    try:
        base = await fetcher.basemap("osm", EXTENT, 500)
    finally:
        await fetcher.aclose()
    assert all(r.headers["User-Agent"] == "Meine-Instanz/1.0 (admin@example.org)" for r in seen)
    assert base.image.size[0] >= TILE_SIZE  # die 404-Kachel blieb leer, der Rest wurde geladen
