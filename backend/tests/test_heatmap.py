import math
import uuid

from app.services.geo import from_local_xy
from app.services.heatmap import GridSpec, compute_grid
from tests.conftest import CENTER
from tests.test_measurements import values

LAT, LON = CENTER["lat"], CENTER["lon"]


def spec(**kw):
    base = dict(
        center_lat=LAT,
        center_lon=LON,
        radius_m=500,
        resolution=20,
        vmin=-30.0,
        vmax=50.0,
        min_points=4,
        max_points=700,
    )
    base.update(kw)
    return GridSpec(**base)


def pts(*xyz):
    out = []
    for x, y, v in xyz:
        lat, lon = from_local_xy(x, y, LAT, LON)
        out.append((lat, lon, v))
    return out


FIVE = pts((0, 0, 10), (200, 0, 20), (-200, 100, 15), (0, -250, 30), (100, 300, 25))


# ------------------------------------------------------------------ Gitter


def test_too_few_points():
    assert compute_grid([], spec())["status"] == "insufficient_data"
    result = compute_grid(FIVE[:3], spec())
    assert result["status"] == "insufficient_data" and result["point_count"] == 3
    assert "grid" not in result


def test_identical_coordinates_are_averaged_before_counting():
    same = pts((0, 0, 10), (0, 0, 20), (0, 0, 30), (0, 0, 40), (0, 0, 50))
    result = compute_grid(same, spec())
    assert result["status"] == "insufficient_data"  # nur ein eindeutiger Ort
    assert result["point_count"] == 1

    mixed = same + pts((200, 0, 20), (-200, 100, 15), (0, -250, 30))
    assert compute_grid(mixed, spec())["point_count"] == 4


def test_kriging_grid_shape_and_circle_mask():
    result = compute_grid(FIVE, spec(resolution=20))
    assert result["status"] == "ok" and result["method"] == "kriging"
    grid = result["grid"]
    assert grid["rows"] == grid["cols"] == 20 and len(grid["values"]) == 20
    assert all(len(row) == 20 for row in grid["values"])
    assert grid["values"][0][0] is None  # Ecke liegt außerhalb des Kreises
    assert grid["values"][10][10] is not None  # Mitte innerhalb
    assert len(grid["variance"]) == 20
    n = 20
    for i in range(n):
        for j in range(n):
            x, y = -500 + (j + 0.5) * 50, 500 - (i + 0.5) * 50
            assert (grid["values"][i][j] is not None) == (x * x + y * y <= 500**2)
    b = result["bounds"]
    assert b["south"] < LAT < b["north"] and b["west"] < LON < b["east"]
    assert result["value_range"] == {"min": -30.0, "max": 50.0}


def test_kriging_stays_within_metric_bounds_and_close_to_data():
    result = compute_grid(FIVE, spec(vmin=12.0, vmax=22.0))
    flat = [v for row in result["grid"]["values"] for v in row if v is not None]
    assert min(flat) >= 12.0 and max(flat) <= 22.0  # auf Grenzen der Messgröße beschnitten


def test_constant_values_do_not_crash():
    flat = pts((0, 0, 7), (200, 0, 7), (-200, 100, 7), (0, -250, 7), (100, 300, 7))
    result = compute_grid(flat, spec())
    assert result["status"] == "ok" and result["method"] == "idw_fallback"
    values_ = {v for row in result["grid"]["values"] for v in row if v is not None}
    assert values_ == {7.0}
    assert {v for row in result["grid"]["variance"] for v in row if v is not None} == {0.0}


def test_collinear_points_still_give_finite_grid():
    line = pts((-300, 0, 10), (-100, 0, 14), (100, 0, 18), (300, 0, 22))
    result = compute_grid(line, spec())
    assert result["status"] == "ok"
    flat = [v for row in result["grid"]["values"] for v in row if v is not None]
    assert all(math.isfinite(v) for v in flat)


def test_many_points_are_aggregated():
    golden = math.pi * (3 - math.sqrt(5))
    many = []
    for i in range(400):  # deterministische Spirale statt Zufall
        r = 480 * math.sqrt((i + 0.5) / 400)
        x, y = r * math.cos(i * golden), r * math.sin(i * golden)
        many.append((x, y, 15 + x / 50 + (i % 7) / 7))
    result = compute_grid(pts(*many), spec(max_points=50, resolution=15))
    assert result["status"] == "ok"
    assert result["point_count"] <= 30 * 30  # auf das Raster verdichtet
    assert result["point_count"] < 400


def test_auto_bounds_use_exactly_the_data_range():
    result = compute_grid(FIVE, spec(vmin=None, vmax=None))
    assert result["status"] == "ok"
    assert result["value_range"] == {"min": 10.0, "max": 30.0}  # kleinster/größter Messwert
    flat = [v for row in result["grid"]["values"] for v in row if v is not None]
    assert min(flat) >= 10.0 and max(flat) <= 30.0  # Interpolation bleibt in diesem Bereich


# Fünf Punkte wie im Fehlerbericht: Wohlbefinden 1..10, weit verstreut im Kreis
SPARSE = pts((-150, 120, 3), (60, 200, 9), (-250, -40, 2), (180, -20, 1), (-30, -180, 8))


def test_points_influence_each_other_instead_of_falling_back_to_the_mean():
    """Regression: Das Feld darf abseits der Punkte nicht auf den Mittelwert zurückfallen."""
    result = compute_grid(SPARSE, spec(radius_m=400, resolution=40, vmin=None, vmax=None))
    assert result["method"] == "kriging"
    values = [v for row in result["grid"]["values"] for v in row if v is not None]
    mean = sum([3, 9, 2, 1, 8]) / 5
    near_mean = [v for v in values if abs(v - mean) < 0.05 * (9 - 1)]
    assert len(near_mean) / len(values) < 0.2  # früher: praktisch die ganze Fläche
    assert max(values) - min(values) > 5  # fast der ganze Wertebereich kommt im Bild vor
    assert min(values) >= 1 and max(values) <= 9


def test_field_is_close_to_the_values_at_the_points():
    result = compute_grid(SPARSE, spec(radius_m=400, resolution=100, vmin=None, vmax=None))
    n = 100
    cell = 800 / n
    for x, y, value in [(-150, 120, 3), (60, 200, 9), (180, -20, 1)]:
        i, j = int((400 - y) / cell), int((x + 400) / cell)
        assert abs(result["grid"]["values"][i][j] - value) < 0.8


def test_kriging_follows_a_trend_instead_of_averaging_it_away():
    # Werte steigen von West nach Ost; im Osten ohne Messpunkte darf es nicht zum Mittelwert werden
    trend = pts((-300, 0, 10), (-200, 100, 12), (-100, -100, 14), (0, 50, 16), (100, -50, 18))
    result = compute_grid(trend, spec(resolution=40, vmin=None, vmax=None))
    rows = result["grid"]["values"]
    west = [v for row in rows for v in row[:8] if v is not None]
    east = [v for row in rows for v in row[-8:] if v is not None]
    assert sum(east) / len(east) > sum(west) / len(west) + 3


def test_fixed_metric_bounds_are_still_available():
    result = compute_grid(FIVE, spec(vmin=-30.0, vmax=50.0))
    assert result["value_range"] == {"min": -30.0, "max": 50.0}


# --------------------------------------------------------------------- API


def add_points(api, p, count=6, base_time=None):
    out = []
    for i in range(count):
        lat, lon = from_local_xy(-250 + i * 90, (-1) ** i * 120, LAT, LON)
        r = api.measure(p, lat=lat, lon=lon, values=values(p, 10 + 3 * i))
        assert r.status_code == 201, r.text
        out.append(r.json())
    return out


def heat(api, p, **params):
    params.setdefault("metric", p["metrics"]["Temperatur"]["id"])
    return api.get(f"/projects/{p['id']}/heatmap", params=params)


def test_heatmap_endpoint_ok_and_insufficient(api, alice):
    p = api.project(alice)
    r = heat(api, p)
    assert r.status_code == 200 and r.json()["status"] == "insufficient_data"
    add_points(api, p)
    r = heat(api, p, resolution=12)
    body = r.json()
    assert body["status"] == "ok" and body["metric_id"] == p["metrics"]["Temperatur"]["id"]
    assert body["point_count"] == 6 and body["grid"]["rows"] == 12
    assert body["from"] is None and body["computed_at"]


def test_heatmap_respects_time_range_and_hidden(api, alice, db):
    p = api.project(alice)
    ms = add_points(api, p, 6)
    db.execute("UPDATE measurements SET measured_at = '2026-01-01T12:00:00Z'")
    db.execute(
        "UPDATE measurements SET measured_at = '2026-02-01T12:00:00Z' WHERE id = %s", (ms[0]["id"],)
    )
    assert heat(api, p).json()["point_count"] == 6
    only_jan = heat(api, p, to="2026-01-15T00:00:00Z").json()
    assert only_jan["point_count"] == 5
    assert only_jan["to"].startswith("2026-01-15")
    assert heat(api, p, **{"from": "2026-01-15T00:00:00Z"}).json()["status"] == "insufficient_data"

    api.patch(f"/projects/{p['id']}/measurements/{ms[1]['id']}", alice, json={"hidden": True})
    assert heat(api, p).json()["point_count"] == 5  # ausgeblendete zählen nicht


def test_heatmap_cache_is_invalidated_by_changes(api, alice):
    p = api.project(alice)
    ms = add_points(api, p, 5)
    first = heat(api, p).json()
    assert first["point_count"] == 5
    assert heat(api, p).json()["computed_at"] == first["computed_at"]  # aus dem Cache

    api.measure(p, lat=LAT + 0.001, values=values(p, 33))
    second = heat(api, p).json()
    assert second["point_count"] == 6 and second["computed_at"] != first["computed_at"]

    api.delete(f"/projects/{p['id']}/measurements/{ms[0]['id']}", alice)
    assert heat(api, p).json()["point_count"] == 5


def test_heatmap_debounce_serves_recent_result(make_api):
    api = make_api(heatmap_min_interval_s=3600)
    alice = api.register("alice")
    p = api.project(alice)
    add_points(api, p, 5)
    assert heat(api, p).json()["point_count"] == 5
    api.measure(p, lat=LAT + 0.001, values=values(p, 33))
    assert heat(api, p).json()["point_count"] == 5  # entprellt: noch das alte Ergebnis


def test_heatmap_per_metric(api, alice):
    p = api.project(alice)
    for i in range(5):
        lat, lon = from_local_xy(-200 + i * 100, i * 20, LAT, LON)
        api.measure(p, lat=lat, lon=lon, values=values(p, 20, mood=1 + i * 2))
    mood = p["metrics"]["Wohlbefinden"]["id"]
    body = heat(api, p, metric=mood).json()  # Standard: Skala aus den vorhandenen Daten
    assert body["status"] == "ok" and body["value_range"] == {"min": 1.0, "max": 9.0}
    fixed = heat(api, p, metric=mood, bounds="metric").json()
    assert fixed["value_range"] == {"min": 1.0, "max": 10.0}  # Grenzen der Messgröße


def test_heatmap_validation(api, alice):
    p = api.project(alice)
    base = f"/projects/{p['id']}/heatmap"
    assert api.get(base).status_code == 422  # metric fehlt
    assert api.get(base, params={"metric": str(uuid.uuid4())}).json()["code"] == "unknown_metric"
    other = api.project(alice)
    r = api.get(base, params={"metric": other["metrics"]["Temperatur"]["id"]})
    assert r.json()["code"] == "unknown_metric"  # Messgröße eines anderen Projekts
    temp = p["metrics"]["Temperatur"]["id"]
    assert api.get(base, params={"metric": temp, "resolution": 5}).status_code == 422
    assert api.get(base, params={"metric": temp, "resolution": 500}).status_code == 422
    r = api.get(
        base, params={"metric": temp, "from": "2026-02-01T00:00:00Z", "to": "2026-01-01T00:00:00Z"}
    )
    assert r.status_code == 422
