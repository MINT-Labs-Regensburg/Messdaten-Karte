import pytest

from app.errors import ApiError
from app.services.geo import circle_bounds, from_local_xy, haversine_m, in_circle, to_local_xy
from app.services.ratelimit import RateLimiter


def test_haversine_known_distance():
    # 0,001° Breitengrad ≈ 111,2 m
    assert haversine_m(49.0, 12.0, 49.001, 12.0) == pytest.approx(111.19, abs=0.1)
    assert haversine_m(49.0, 12.0, 49.0, 12.0) == 0


def test_circle_boundary_is_inclusive():
    lat, lon = 49.0, 12.0
    d = haversine_m(lat, lon, lat + 0.003, lon)
    assert in_circle(lat + 0.003, lon, lat, lon, d)
    assert not in_circle(lat + 0.003, lon, lat, lon, d - 0.01)


def test_local_projection_roundtrip():
    x, y = to_local_xy(49.003, 12.004, 49.0, 12.0)
    lat, lon = from_local_xy(x, y, 49.0, 12.0)
    assert (lat, lon) == pytest.approx((49.003, 12.004))
    bounds = circle_bounds(49.0, 12.0, 500)
    assert bounds["south"] < 49.0 < bounds["north"] and bounds["west"] < 12.0 < bounds["east"]
    assert haversine_m(49.0, 12.0, bounds["north"], 12.0) == pytest.approx(500, abs=1)


def test_rate_limiter_window(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr("app.services.ratelimit.time.monotonic", lambda: clock[0])
    limiter = RateLimiter()
    limiter.hit("k", 2, 60)
    limiter.hit("k", 2, 60)
    with pytest.raises(ApiError) as exc:
        limiter.hit("k", 2, 60)
    assert exc.value.status_code == 429 and int(exc.value.headers["Retry-After"]) >= 1
    limiter.hit("other", 2, 60)  # eigener Schlüssel
    clock[0] += 61
    limiter.hit("k", 2, 60)  # Fenster abgelaufen


def test_rate_limiter_check_does_not_count_and_reset_clears():
    limiter = RateLimiter()
    for _ in range(5):
        limiter.check("k", 1, 60)
    limiter.add("k", 60)
    with pytest.raises(ApiError):
        limiter.check("k", 1, 60)
    limiter.reset("k")
    limiter.check("k", 1, 60)
