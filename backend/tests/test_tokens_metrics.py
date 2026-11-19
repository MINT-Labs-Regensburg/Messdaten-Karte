from datetime import UTC, datetime, timedelta

from tests.conftest import Actor
from tests.test_measurements import make_token, values


def test_token_lifecycle_plaintext_shown_once_and_hashed(api, alice, db):
    r = api.post("/tokens", alice, json={"name": "esp32", "scope": "measurements:write"})
    assert r.status_code == 201
    created = r.json()
    assert created["token"].startswith("mdk_") and created["prefix"] == created["token"][:8]

    listed = api.get("/tokens", alice).json()
    assert [t["name"] for t in listed] == ["esp32"]
    assert "token" not in listed[0]
    stored = db.execute("SELECT token_hash FROM api_tokens").fetchone()[0]
    assert created["token"] not in stored and len(stored) == 64

    assert api.delete(f"/tokens/{created['id']}", alice).status_code == 204
    assert api.get("/tokens", alice).json() == []
    assert api.delete(f"/tokens/{created['id']}", alice).status_code == 404


def test_tokens_are_per_user(api, alice, bob):
    _, created = make_token(api, alice)
    assert api.get("/tokens", bob).json() == []
    assert api.delete(f"/tokens/{created['id']}", bob).status_code == 404


def test_token_management_requires_session(api, alice):
    full, _ = make_token(api, alice, scope="full")
    assert api.get("/tokens", full).status_code == 403
    assert api.post("/tokens", full, json={"name": "x", "scope": "full"}).status_code == 403
    assert api.get("/tokens").status_code == 401


def test_write_scope_only_allows_measurements(api, alice):
    p = api.project(alice, is_public=False)
    sensor, _ = make_token(api, alice, scope="measurements:write")
    assert api.measure(p, sensor).status_code == 201
    r = api.get(f"/projects/{p['id']}", sensor)
    assert r.status_code == 403 and r.json()["code"] == "insufficient_scope"
    assert api.get(f"/projects/{p['id']}/measurements", sensor).status_code == 403
    assert api.get("/projects", sensor).status_code == 403
    assert api.get("/me", sensor).json()["user"]["username"] == "alice"  # Token prüfbar


def test_full_scope_acts_with_user_rights_without_csrf(api, alice, bob):
    full, _ = make_token(api, alice, scope="full")
    p = api.post(
        "/projects",
        full,
        json={"name": "via token", "center": {"lat": 1, "lon": 1}, "radius_m": 10},
    )
    assert p.status_code == 201 and p.json()["my_role"] == "owner"
    assert api.get("/projects", full).json()["total"] == 1
    other = api.project(bob, is_public=False)
    assert api.get(f"/projects/{other['id']}", full).status_code == 404  # Rechte des Benutzers


def test_token_of_non_member_follows_editable_rule(api, alice, bob):
    p = api.project(alice, is_editable=False)
    sensor, _ = make_token(api, bob)
    assert api.measure(p, sensor).status_code == 403
    api.patch(f"/projects/{p['id']}", alice, json={"is_editable": True})
    assert api.measure(p, sensor).status_code == 201


def test_project_bound_token(api, alice):
    p1, p2 = api.project(alice), api.project(alice)
    sensor, _ = make_token(api, alice, project_id=p1["id"])
    assert api.measure(p1, sensor).status_code == 201
    r = api.measure(p2, sensor)
    assert r.status_code == 403 and r.json()["code"] == "token_project_mismatch"

    full, _ = make_token(api, alice, scope="full", project_id=p1["id"])
    assert api.get(f"/projects/{p1['id']}", full).status_code == 200
    assert api.get(f"/projects/{p2['id']}", full).status_code == 403
    assert api.get("/projects", full).status_code == 403  # nicht kontoweit nutzbar
    assert (
        api.post(
            "/projects", full, json={"name": "x", "center": {"lat": 1, "lon": 1}, "radius_m": 5}
        ).status_code
        == 403
    )


def test_invalid_revoked_expired_tokens(api, alice, db):
    p = api.project(alice)
    sensor, created = make_token(api, alice)
    assert api.measure(p, sensor).status_code == 201

    bad = Actor()
    bad.bearer = "mdk_unbekannt"
    r = api.measure(p, bad)
    assert r.status_code == 401 and r.json()["code"] == "invalid_token"  # kein Fallback auf anonym

    db.execute("UPDATE api_tokens SET expires_at = now() - interval '1 minute'")
    assert api.measure(p, sensor).status_code == 401
    db.execute("UPDATE api_tokens SET expires_at = NULL")
    assert api.measure(p, sensor).status_code == 201
    api.delete(f"/tokens/{created['id']}", alice)
    assert api.measure(p, sensor).status_code == 401


def test_token_of_deactivated_user_stops_working(api, admin, alice):
    p = api.project(alice)
    sensor, _ = make_token(api, alice)
    api.patch(f"/admin/users/{alice.id}", admin, json={"is_active": False})
    assert api.measure(p, sensor).status_code == 401


def test_token_last_used_is_tracked(api, alice):
    p = api.project(alice)
    sensor, _ = make_token(api, alice)
    assert api.get("/tokens", alice).json()[0]["last_used_at"] is None
    api.measure(p, sensor)
    assert api.get("/tokens", alice).json()[0]["last_used_at"] is not None


def test_token_validation(api, alice):
    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    assert api.post("/tokens", alice, json={"name": "x", "scope": "root"}).status_code == 422
    assert api.post("/tokens", alice, json={"name": "", "scope": "full"}).status_code == 422
    r = api.post("/tokens", alice, json={"name": "x", "scope": "full", "expires_at": past})
    assert r.status_code == 422
    r = api.post(
        "/tokens",
        alice,
        json={"name": "x", "scope": "full", "project_id": "00000000-0000-4000-8000-000000000000"},
    )
    assert r.status_code == 422


# ------------------------------------------------------------------ Messgrößen


def test_metric_crud_permissions(api, alice, bob):
    p = api.project(alice)
    url = f"/projects/{p['id']}/metrics"
    body = {"name": "Feinstaub", "unit": "µg/m³", "type": "number", "min": 0, "max": 500}
    assert api.post(url, json=body).status_code == 401
    assert api.post(url, bob, json=body).status_code == 403
    created = api.post(url, alice, json=body)
    assert created.status_code == 201
    assert created.json()["position"] == 2 and created.json()["color_scale"] == {"name": "viridis"}
    assert api.get(url).status_code == 200  # öffentlich lesbar
    assert api.post(url, alice, json=body).status_code == 409  # Name doppelt

    mid = created.json()["id"]
    assert api.patch(f"{url}/{mid}", bob, json={"name": "x"}).status_code == 403
    r = api.patch(f"{url}/{mid}", alice, json={"name": "PM10", "color_scale": {"name": "plasma"}})
    assert r.status_code == 200 and r.json()["name"] == "PM10"
    assert api.delete(f"{url}/{mid}", bob).status_code == 403
    assert api.delete(f"{url}/{mid}", alice).status_code == 204


def test_metric_validation(api, alice):
    url = f"/projects/{api.project(alice)['id']}/metrics"
    bad = [
        {"name": "x", "type": "number", "min": 5, "max": 5},
        {"name": "x", "type": "number", "min": 5, "max": 1},
        {"name": "x", "type": "scale", "min": 0.5, "max": 10},
        {"name": "x", "type": "other", "min": 0, "max": 1},
        {"name": "x", "type": "number", "min": 0, "max": 1, "color_scale": {"name": "custom"}},
        {
            "name": "x",
            "type": "number",
            "min": 0,
            "max": 1,
            "color_scale": {"name": "viridis", "stops": [{"at": 0, "color": "#000000"}]},
        },
        {"name": "x", "type": "number", "min": 0, "max": 1, "color_scale": {"name": "nope"}},
    ]
    for body in bad:
        assert api.post(url, alice, json=body).status_code == 422, body
    custom = {
        "name": "ok",
        "type": "number",
        "min": 0,
        "max": 1,
        "color_scale": {
            "name": "custom",
            "stops": [{"at": 0, "color": "#0000ff"}, {"at": 1, "color": "#ff0000"}],
        },
    }
    assert api.post(url, alice, json=custom).status_code == 201


def test_metric_range_change_must_keep_values_valid(api, alice):
    p = api.project(alice)
    api.measure(p, values=values(p, temp=40))
    temp = p["metrics"]["Temperatur"]["id"]
    url = f"/projects/{p['id']}/metrics/{temp}"
    r = api.patch(url, alice, json={"max": 30})
    assert r.status_code == 409 and r.json()["code"] == "values_out_of_range"
    assert api.patch(url, alice, json={"max": 45}).json()["max"] == 45
    assert api.patch(url, alice, json={"min": 60}).status_code == 422  # min >= max
    mood = p["metrics"]["Wohlbefinden"]["id"]
    assert (
        api.patch(f"/projects/{p['id']}/metrics/{mood}", alice, json={"max": 7.5}).status_code
        == 422
    )


def test_delete_metric_removes_values_and_empty_measurements(api, alice):
    p = api.project(alice)
    only_temp = api.measure(p, values=values(p, 10)).json()
    both = api.measure(p, values=values(p, 12, mood=3)).json()
    temp = p["metrics"]["Temperatur"]["id"]
    assert api.delete(f"/projects/{p['id']}/metrics/{temp}", alice).status_code == 204

    items = api.get(f"/projects/{p['id']}/measurements").json()["items"]
    assert [m["id"] for m in items] == [both["id"]]  # ohne Werte bleibt keine Messung übrig
    assert [v["metric_id"] for v in items[0]["values"]] == [p["metrics"]["Wohlbefinden"]["id"]]
    assert only_temp["id"] not in [m["id"] for m in items]


def test_metric_of_other_project_is_404(api, alice):
    p1, p2 = api.project(alice), api.project(alice)
    foreign = p2["metrics"]["Temperatur"]["id"]
    assert (
        api.patch(f"/projects/{p1['id']}/metrics/{foreign}", alice, json={"name": "x"}).status_code
        == 404
    )
    assert api.delete(f"/projects/{p1['id']}/metrics/{foreign}", alice).status_code == 404
