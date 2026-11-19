import csv
import io
import json

from tests.conftest import CENTER
from tests.test_measurements import values


def export(api, p, actor=None, **body):
    return api.post(f"/projects/{p['id']}/exports", actor, json=body)


def fill(api, p, alice):
    temp = p["metrics"]["Temperatur"]["id"]
    mood = p["metrics"]["Wohlbefinden"]["id"]
    a = api.measure(p, alice, author_name="Anna", note="warm hier", values=values(p, 21.5, mood=7))
    b = api.measure(
        p, lat=CENTER["lat"] + 0.002, author_name="=HYPERLINK(1)", note="@sum", values=values(p, 18)
    )
    hidden = api.measure(p, lat=CENTER["lat"] - 0.002, values=values(p, 30)).json()
    api.patch(f"/projects/{p['id']}/measurements/{hidden['id']}", alice, json={"hidden": True})
    return a.json(), b.json(), hidden, temp, mood


def rows(response):
    return list(csv.reader(io.StringIO(response.text)))


def test_csv_selection(api, alice):
    p = api.project(alice)
    fill(api, p, alice)
    r = export(api, p, format="csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    table = rows(r)
    assert table[0] == ["id", "measured_at", "lat", "lon", "Temperatur [°C]", "Wohlbefinden"]
    assert len(table) == 3  # ausgeblendete fehlt
    assert table[1][4:] == ["21.5", "7.0"] and table[2][4:] == ["18.0", ""]
    assert "Anna" not in r.text and "warm hier" not in r.text  # Namen/Notizen sind opt-in


def test_csv_with_notes_hidden_and_metric_subset(api, alice):
    p = api.project(alice)
    _, _, _, temp, _ = fill(api, p, alice)
    r = export(
        api,
        p,
        alice,
        format="csv",
        select={"include_hidden": True, "include_notes_and_names": True, "metric_ids": [temp]},
    )
    table = rows(r)
    assert table[0][4:] == ["author_name", "note", "hidden", "Temperatur [°C]"]
    assert len(table) == 4
    assert any(row[table[0].index("hidden")] == "True" for row in table[1:])


def test_csv_injection_is_neutralised(api, alice):
    p = api.project(alice)
    fill(api, p, alice)
    table = rows(export(api, p, format="csv", select={"include_notes_and_names": True}))
    cells = [c for row in table for c in row]
    assert "'=HYPERLINK(1)" in cells and "'@sum" in cells
    assert "=HYPERLINK(1)" not in cells


def test_hidden_export_requires_member(api, alice, bob):
    p = api.project(alice)
    sel = {"include_hidden": True}
    assert export(api, p, format="csv", select=sel).status_code == 401
    assert export(api, p, bob, format="csv", select=sel).status_code == 403
    assert export(api, p, alice, format="csv", select=sel).status_code == 200


def test_time_range_filter(api, alice, db):
    p = api.project(alice)
    fill(api, p, alice)
    db.execute("UPDATE measurements SET measured_at = '2026-01-01T00:00:00Z'")
    r = export(api, p, format="csv", select={"from": "2026-02-01T00:00:00Z"})
    assert len(rows(r)) == 1
    bad = export(
        api, p, format="csv", select={"from": "2026-02-01T00:00:00Z", "to": "2026-01-01T00:00:00Z"}
    )
    assert bad.status_code == 422


def test_geojson(api, alice):
    p = api.project(alice)
    a, *_ = fill(api, p, alice)
    r = export(api, p, format="geojson", select={"include_notes_and_names": True})
    assert r.headers["content-type"].startswith("application/geo+json")
    data = json.loads(r.text)
    assert data["type"] == "FeatureCollection" and len(data["features"]) == 2
    first = next(f for f in data["features"] if f["properties"]["id"] == a["id"])
    assert first["geometry"] == {"type": "Point", "coordinates": [a["lon"], a["lat"]]}
    assert first["properties"]["values"] == {"Temperatur": 21.5, "Wohlbefinden": 7.0}
    assert first["properties"]["author_name"] == "Anna"
    plain = json.loads(export(api, p, format="geojson").text)
    assert "note" not in plain["features"][0]["properties"]


def test_export_of_private_project_is_hidden(api, alice, bob):
    p = api.project(alice, is_public=False)
    assert export(api, p, format="csv").status_code == 404
    assert export(api, p, bob, format="csv").status_code == 404


def test_export_validation(api, alice):
    p = api.project(alice)
    assert export(api, p, format="xls").status_code == 422
    r = export(
        api, p, format="csv", select={"metric_ids": ["00000000-0000-4000-8000-000000000000"]}
    )
    assert r.json()["code"] == "unknown_metric"
    v = export(api, p, format="video")
    assert v.status_code == 422 and v.json()["code"] == "format_not_supported"


def image_body(p, fmt, **image):
    return {
        "format": fmt,
        "image": {"metric_id": p["metrics"]["Temperatur"]["id"], **image},
    }


def points_for_image(api, p):
    for i, (dx, dy) in enumerate(
        [(0, 0), (0.002, 0), (-0.002, 0.001), (0, -0.003), (0.001, 0.003)]
    ):
        api.measure(p, lat=CENTER["lat"] + dy, lon=CENTER["lon"] + dx, values=values(p, 10 + 4 * i))


def test_svg_is_vector_only(api, alice):
    p = api.project(alice)
    points_for_image(api, p)
    r = api.post(f"/projects/{p['id']}/exports", json=image_body(p, "svg", show_legend=True))
    assert r.status_code == 200 and r.headers["content-type"] == "image/svg+xml"
    assert r.text.lstrip().startswith("<?xml") and "<svg" in r.text
    assert "<image" not in r.text and "data:image" not in r.text  # keine Pixelgrafik
    assert "<path" in r.text


def test_png_and_jpeg_with_resolution(api, alice):
    p = api.project(alice)
    points_for_image(api, p)
    png = api.post(
        f"/projects/{p['id']}/exports",
        json=image_body(p, "png", width_px=400, height_px=300, dpi=100),
    )
    assert png.status_code == 200 and png.content[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = (
        int.from_bytes(png.content[16:20], "big"),
        int.from_bytes(png.content[20:24], "big"),
    )
    assert (width, height) == (400, 300)
    jpg = api.post(f"/projects/{p['id']}/exports", json=image_body(p, "jpeg", width_px=300))
    assert jpg.status_code == 200 and jpg.content[:2] == b"\xff\xd8"
    assert (
        "filename" in jpg.headers["content-disposition"]
        and ".jpg" in jpg.headers["content-disposition"]
    )


def test_image_without_enough_points_still_renders(api, alice):
    p = api.project(alice)
    r = api.post(
        f"/projects/{p['id']}/exports", json=image_body(p, "png", width_px=200, height_px=200)
    )
    assert r.status_code == 200 and r.content[:4] == b"\x89PNG"


def test_image_validation(api, alice):
    p = api.project(alice)
    url = f"/projects/{p['id']}/exports"
    assert (
        api.post(url, json={"format": "svg"}).json()["code"] == "unknown_metric"
    )  # metric_id fehlt
    r = api.post(url, json=image_body(p, "svg", basemap="osm"))
    assert r.status_code == 422 and r.json()["code"] == "basemap_not_supported"
    assert api.post(url, json=image_body(p, "svg", basemap="satellite")).status_code == 422
    assert api.post(url, json=image_body(p, "png", basemap="strasse")).status_code == 422
    assert api.post(url, json=image_body(p, "png", width_px=50)).status_code == 422
    assert api.post(url, json=image_body(p, "png", width_px=9000)).status_code == 422
    assert api.post(url, json=image_body(p, "png", dpi=10)).status_code == 422


# ------------------------------------------------- Bildexport mit Hintergrundkarte

MAGENTA = (200, 0, 200)


def fake_tiles(color=MAGENTA, fail=False):
    """Ersetzt den Kachelserver: liefert einfarbige Kacheln und merkt sich die angefragten URLs."""
    from PIL import Image

    from app.services.tiles import TileFetcher

    urls: list[str] = []
    buffer = io.BytesIO()
    Image.new("RGB", (256, 256), color).save(buffer, format="PNG")

    async def fetch(url: str) -> bytes:
        urls.append(url)
        if fail:
            raise RuntimeError("Kachelserver nicht erreichbar")
        return buffer.getvalue()

    return TileFetcher("test-agent", fetch=fetch), urls


def share_of_color(png: bytes, color=MAGENTA, tolerance=40) -> float:
    from PIL import Image

    image = Image.open(io.BytesIO(png)).convert("RGB")
    data = image.tobytes()
    pixels = [tuple(data[i : i + 3]) for i in range(0, len(data), 3)]
    close = sum(
        1 for px in pixels if all(abs(a - b) <= tolerance for a, b in zip(px, color, strict=True))
    )
    return close / len(pixels)


def test_png_contains_the_map_background(api, alice):
    p = api.project(alice)
    points_for_image(api, p)
    api.client.app.state.tile_fetcher, urls = fake_tiles()
    body = image_body(p, "png", width_px=500, height_px=500, basemap="osm")
    r = api.post(f"/projects/{p['id']}/exports", json=body)
    assert r.status_code == 200 and r.content[:4] == b"\x89PNG"
    assert urls and all("tile.openstreetmap.org" in u for u in urls)
    assert share_of_color(r.content) > 0.05  # Hintergrundkarte ist im Bild (außerhalb des Kreises)

    without = api.post(
        f"/projects/{p['id']}/exports", json=image_body(p, "png", width_px=500, height_px=500)
    )
    assert share_of_color(without.content) == 0  # ohne Hintergrundkarte keine Kacheln


def test_jpeg_and_satellite_background(api, alice):
    p = api.project(alice)
    points_for_image(api, p)
    api.client.app.state.tile_fetcher, urls = fake_tiles()
    body = image_body(p, "jpeg", width_px=400, height_px=400, basemap="satellite")
    r = api.post(f"/projects/{p['id']}/exports", json=body)
    assert r.status_code == 200 and r.content[:2] == b"\xff\xd8"
    assert urls and all("arcgisonline.com" in u for u in urls)


def test_background_works_without_enough_points_for_a_heatmap(api, alice):
    p = api.project(alice)
    api.client.app.state.tile_fetcher, _ = fake_tiles()
    r = api.post(
        f"/projects/{p['id']}/exports",
        json=image_body(p, "png", width_px=300, height_px=300, basemap="osm"),
    )
    assert r.status_code == 200 and share_of_color(r.content) > 0.05


def test_unreachable_tile_server_gives_a_clear_error(api, alice):
    p = api.project(alice)
    points_for_image(api, p)
    api.client.app.state.tile_fetcher, _ = fake_tiles(fail=True)
    r = api.post(
        f"/projects/{p['id']}/exports",
        json=image_body(p, "png", width_px=300, height_px=300, basemap="osm"),
    )
    assert r.status_code == 502 and r.json()["code"] == "basemap_unavailable"


def test_export_requests_a_bounded_number_of_tiles(api, alice):
    p = api.project(alice)
    api.client.app.state.tile_fetcher, urls = fake_tiles()
    api.post(
        f"/projects/{p['id']}/exports",
        json=image_body(p, "png", width_px=8000, height_px=8000, basemap="osm"),
    )
    assert 0 < len(urls) <= 49  # auch bei maximaler Bildgröße nicht hunderte Anfragen
