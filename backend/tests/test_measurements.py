import json
import uuid
from datetime import UTC, datetime, timedelta

from tests.conftest import CENTER, Actor


def values(project, temp=20.0, mood=None):
    out = [{"metric_id": project["metrics"]["Temperatur"]["id"], "value": temp}]
    if mood is not None:
        out.append({"metric_id": project["metrics"]["Wohlbefinden"]["id"], "value": mood})
    return out


# -------------------------------------------------------- Berechtigungsmatrix


def test_add_matrix_editable_public(api, alice, bob):
    p = api.project(alice)  # öffentlich + bearbeitbar
    assert api.measure(p).status_code == 201  # anonym
    assert api.measure(p, bob).status_code == 201  # angemeldet, kein Mitglied
    assert api.measure(p, alice).status_code == 201  # Mitglied


def test_add_matrix_public_not_editable(api, alice, bob, admin):
    p = api.project(alice, is_editable=False)
    r = api.measure(p)
    assert r.status_code == 403 and r.json()["code"] == "project_not_editable"
    assert api.measure(p, bob).status_code == 403
    assert api.measure(p, alice).status_code == 201  # Mitglieder immer
    assert api.measure(p, admin).status_code == 201  # Admin immer


def test_add_matrix_private(api, alice, bob):
    p = api.project(alice, is_public=False, is_editable=True)
    assert api.measure(p).status_code == 404
    assert api.measure(p, bob).status_code == 404
    assert api.measure(p, alice).status_code == 201


def test_anonymous_get_edit_token_users_do_not(api, alice):
    p = api.project(alice)
    anon = api.measure(p).json()
    assert anon["edit_token"] and anon["source"] == "anonymous"
    exp = datetime.fromisoformat(anon["edit_expires_at"])
    assert timedelta(minutes=14) < exp - datetime.now(UTC) <= timedelta(minutes=15)
    user = api.measure(p, alice).json()
    assert user["edit_token"] is None and user["source"] == "user"
    listed = api.get(f"/projects/{p['id']}/measurements").json()["items"]
    assert all("edit_token" not in m for m in listed)


# ---------------------------------------------------------------- Validierung


def test_point_must_lie_inside_circle(api, alice):
    p = api.project(alice)
    r = api.measure(p, lat=CENTER["lat"] + 0.006)  # ~667 m > 500 m
    assert r.status_code == 422
    assert r.json()["code"] == "point_outside_circle"
    assert api.measure(p, lat=CENTER["lat"] + 0.004).status_code == 201  # ~445 m


def test_value_bounds_and_types(api, alice):
    p = api.project(alice)
    url = f"/projects/{p['id']}/measurements"
    temp, mood = p["metrics"]["Temperatur"]["id"], p["metrics"]["Wohlbefinden"]["id"]
    base = dict(CENTER)

    def post(vals):
        return api.post(url, json={**base, "values": vals})

    assert post([{"metric_id": temp, "value": 50.1}]).json()["code"] == "value_out_of_range"
    assert post([{"metric_id": temp, "value": -30.1}]).status_code == 422
    assert post([{"metric_id": temp, "value": 50}]).status_code == 201  # Grenze inklusive
    assert post([{"metric_id": mood, "value": 5.5}]).json()["code"] == "value_not_integer"
    assert post([{"metric_id": mood, "value": 0}]).status_code == 422
    assert post([{"metric_id": mood, "value": 7}]).status_code == 201
    assert post([{"metric_id": temp, "value": "heiß"}]).status_code == 422
    assert post([{"metric_id": str(uuid.uuid4()), "value": 1}]).json()["code"] == "unknown_metric"
    assert post([]).status_code == 422  # mindestens ein Wert
    dup = [{"metric_id": temp, "value": 1}, {"metric_id": temp, "value": 2}]
    assert post(dup).json()["code"] == "duplicate_metric"


def test_nan_and_infinity_rejected(api, alice):
    p = api.project(alice)
    temp = p["metrics"]["Temperatur"]["id"]
    for bad in ("NaN", "Infinity"):
        # json.dumps erzeugt hier bewusst ungültiges JSON (NaN/Infinity), das Python akzeptiert
        body = json.dumps({**CENTER, "values": [{"metric_id": temp, "value": float(bad)}]})
        r = api.post(
            f"/projects/{p['id']}/measurements",
            content=body,
            headers={"content-type": "application/json"},
        )
        assert r.status_code == 422


def test_values_of_other_projects_metric_rejected(api, alice):
    p1, p2 = api.project(alice), api.project(alice)
    r = api.measure(p1, values=values(p2))
    assert r.json()["code"] == "unknown_metric"


def test_partial_values_allowed_but_not_empty(api, alice):
    p = api.project(alice)
    r = api.measure(p, values=values(p, 10, mood=4))
    assert len(r.json()["values"]) == 2
    assert api.measure(p, values=[]).status_code == 422


def test_limits_and_text_lengths(api, alice):
    p = api.project(alice)
    assert api.measure(p, note="x" * 501).status_code == 422
    assert api.measure(p, author_name="x" * 41).status_code == 422
    assert api.measure(p, lat=100).status_code == 422


def test_measurement_limit_per_project(make_api):
    api = make_api(max_measurements_per_project=2)
    alice = api.register("alice")
    p = api.project(alice)
    assert api.measure(p).status_code == 201
    assert api.measure(p).status_code == 201
    r = api.measure(p)
    assert r.status_code == 409 and r.json()["code"] == "measurement_limit_reached"


def test_anonymous_rate_limit_only_for_anonymous(make_api):
    api = make_api(anon_rate_limit_count=2)
    alice = api.register("alice")
    p = api.project(alice)
    assert api.measure(p).status_code == 201
    assert api.measure(p).status_code == 201
    r = api.measure(p)
    assert r.status_code == 429 and "Retry-After" in r.headers
    assert api.measure(p, alice).status_code == 201  # angemeldet unbeschränkt


# ----------------------------------------------------------- Edit-Token-Fenster


def test_edit_with_token(api, alice):
    p = api.project(alice)
    m = api.measure(p, note="alt").json()
    url = f"/projects/{p['id']}/measurements/{m['id']}"
    token = {"X-Edit-Token": m["edit_token"]}

    r = api.patch(url, headers=token, json={"note": "neu", "values": values(p, 25)})
    assert r.status_code == 200
    assert r.json()["note"] == "neu" and r.json()["values"][0]["value"] == 25

    assert api.patch(url, json={"note": "x"}).status_code == 401  # ohne Token
    assert api.patch(url, headers={"X-Edit-Token": "falsch"}, json={"note": "x"}).status_code == 403
    assert api.delete(url, headers={"X-Edit-Token": "falsch"}).status_code == 403
    assert api.delete(url, headers=token).status_code == 204
    assert api.get(f"/projects/{p['id']}/measurements").json()["items"] == []


def test_edit_token_cannot_hide_and_not_edit_other_measurements(api, alice):
    p = api.project(alice)
    mine, other = api.measure(p).json(), api.measure(p).json()
    token = {"X-Edit-Token": mine["edit_token"]}
    base = f"/projects/{p['id']}/measurements/"
    assert api.patch(base + mine["id"], headers=token, json={"hidden": True}).status_code == 403
    assert api.patch(base + other["id"], headers=token, json={"note": "x"}).status_code == 403


def test_edit_window_expires(api, alice, db):
    p = api.project(alice)
    m = api.measure(p).json()
    url = f"/projects/{p['id']}/measurements/{m['id']}"
    token = {"X-Edit-Token": m["edit_token"]}
    db.execute("UPDATE measurements SET created_at = now() - interval '16 minutes'")
    r = api.patch(url, headers=token, json={"note": "zu spät"})
    assert r.status_code == 403 and r.json()["code"] == "edit_window_expired"
    assert api.delete(url, headers=token).status_code == 403
    db.execute("UPDATE measurements SET created_at = now() - interval '14 minutes'")
    assert api.patch(url, headers=token, json={"note": "gerade noch"}).status_code == 200


def test_edit_token_is_stored_hashed(api, alice, db):
    p = api.project(alice)
    m = api.measure(p).json()
    stored = db.execute("SELECT edit_token_hash FROM measurements").fetchone()[0]
    assert stored and m["edit_token"] not in stored


def test_author_and_moderator_permissions(api, alice, bob, db):
    p = api.project(alice)
    carol = api.register("carol")
    bobs = api.measure(p, bob).json()
    anon = api.measure(p).json()
    base = f"/projects/{p['id']}/measurements/"

    assert api.patch(base + bobs["id"], bob, json={"note": "meine"}).status_code == 200  # Autor
    assert api.patch(base + bobs["id"], carol, json={"note": "x"}).status_code == 403  # fremd
    assert api.delete(base + bobs["id"], carol).status_code == 403
    assert api.patch(base + anon["id"], bob, json={"note": "x"}).status_code == 403
    # Autor darf nicht ausblenden
    assert api.patch(base + bobs["id"], bob, json={"hidden": True}).status_code == 403
    # Mitglied darf fremde Messungen ausblenden und löschen
    assert api.patch(base + anon["id"], alice, json={"hidden": True}).status_code == 200
    assert api.delete(base + bobs["id"], alice).status_code == 204


def test_author_edit_survives_window(api, alice, bob, db):
    p = api.project(alice)
    m = api.measure(p, bob).json()
    db.execute("UPDATE measurements SET created_at = now() - interval '2 days'")
    r = api.patch(f"/projects/{p['id']}/measurements/{m['id']}", bob, json={"note": "spät"})
    assert r.status_code == 200


def test_measurement_of_other_project_is_404(api, alice):
    p1, p2 = api.project(alice), api.project(alice)
    m = api.measure(p1, alice).json()
    assert (
        api.patch(
            f"/projects/{p2['id']}/measurements/{m['id']}", alice, json={"note": "x"}
        ).status_code
        == 404
    )
    assert api.delete(f"/projects/{p2['id']}/measurements/{uuid.uuid4()}", alice).status_code == 404


def test_archived_blocks_edits(api, alice):
    p = api.project(alice)
    m = api.measure(p, alice).json()
    api.put(f"/projects/{p['id']}/archive", alice)
    url = f"/projects/{p['id']}/measurements/{m['id']}"
    assert api.patch(url, alice, json={"note": "x"}).json()["code"] == "project_archived"
    assert api.delete(url, alice).status_code == 409


# ------------------------------------------------------------ Ausblenden/Listen


def test_hidden_measurements(api, alice, bob):
    p = api.project(alice)
    m = api.measure(p).json()
    base = f"/projects/{p['id']}/measurements"
    api.patch(f"{base}/{m['id']}", alice, json={"hidden": True})

    assert api.get(base).json()["items"] == []
    assert api.get(base, bob).json()["items"] == []
    assert api.get(base, alice).json()["items"] == []  # Standard: ohne Ausgeblendete
    shown = api.get(base, alice, params={"include_hidden": "true"}).json()["items"]
    assert [x["id"] for x in shown] == [m["id"]] and shown[0]["hidden"] is True
    assert api.get(base, params={"include_hidden": "true"}).status_code == 401
    assert api.get(base, bob, params={"include_hidden": "true"}).status_code == 403
    assert api.patch(f"{base}/{m['id']}", bob, json={"note": "x"}).status_code == 404
    assert api.get(f"/projects/{p['id']}").json()["measurement_count"] == 0

    api.patch(f"{base}/{m['id']}", alice, json={"hidden": False})
    assert len(api.get(base).json()["items"]) == 1


def test_time_range_and_pagination(api, alice, db):
    p = api.project(alice)
    base = f"/projects/{p['id']}/measurements"
    ids = [api.measure(p, alice, note=f"m{i}").json()["id"] for i in range(5)]
    for i, mid in enumerate(ids):
        db.execute(
            "UPDATE measurements SET measured_at = %s WHERE id = %s",
            (datetime(2026, 1, 1, 12, i, tzinfo=UTC), mid),
        )

    def notes(**params):
        r = api.get(base, params=params)
        return [m["note"] for m in r.json()["items"]], r.json()["next_cursor"]

    assert notes()[0] == ["m0", "m1", "m2", "m3", "m4"]  # aufsteigend nach Zeit
    # von inklusiv, bis exklusiv
    assert notes(**{"from": "2026-01-01T12:01:00Z", "to": "2026-01-01T12:03:00Z"})[0] == [
        "m1",
        "m2",
    ]
    assert (
        api.get(
            base, params={"from": "2026-01-02T00:00:00Z", "to": "2026-01-01T00:00:00Z"}
        ).status_code
        == 422
    )

    first, cursor = notes(limit=2)
    assert first == ["m0", "m1"] and cursor
    second, cursor = notes(limit=2, cursor=cursor)
    assert second == ["m2", "m3"] and cursor
    third, cursor = notes(limit=2, cursor=cursor)
    assert third == ["m4"] and cursor is None
    assert api.get(base, params={"cursor": "kaputt"}).status_code == 422


# ----------------------------------------------------------------- API-Tokens


def make_token(api, owner, scope="measurements:write", **extra):
    r = api.post("/tokens", owner, json={"name": "gerät", "scope": scope, **extra})
    assert r.status_code == 201, r.text
    actor = Actor()
    actor.bearer = r.json()["token"]
    return actor, r.json()


def test_token_can_set_measured_at(api, alice):
    p = api.project(alice)
    sensor, _ = make_token(api, alice)
    when = "2026-01-02T03:04:05Z"
    r = api.measure(p, sensor, measured_at=when)
    assert r.status_code == 201
    assert r.json()["source"] == "api_token"
    assert r.json()["edit_token"] is None  # Token-Messungen brauchen keinen Edit-Token
    assert datetime.fromisoformat(r.json()["measured_at"]) == datetime(
        2026, 1, 2, 3, 4, 5, tzinfo=UTC
    )


def test_measured_at_rules(api, alice):
    p = api.project(alice)
    sensor, _ = make_token(api, alice)
    future = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    r = api.measure(p, sensor, measured_at=future)
    assert r.status_code == 422 and r.json()["code"] == "measured_at_in_future"
    r = api.measure(p, alice, measured_at="2026-01-01T00:00:00Z")  # Session, kein Token
    assert r.status_code == 422 and r.json()["code"] == "measured_at_not_allowed"
    r = api.measure(p, measured_at="2026-01-01T00:00:00Z")
    assert r.status_code == 422
