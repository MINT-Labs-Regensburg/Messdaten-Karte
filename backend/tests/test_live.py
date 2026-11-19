import pytest
from starlette.websockets import WebSocketDisconnect

from tests.conftest import Actor


def connect(api, p, actor: Actor | None = None, headers=None):
    """Öffnet den WebSocket mit den Cookies/Token des Akteurs."""
    client = api.client
    client.cookies.clear()
    hdrs = dict(headers or {})
    if actor:
        for k, v in actor.cookies.items():
            client.cookies.set(k, v)
        if actor.bearer:
            hdrs["Authorization"] = f"Bearer {actor.bearer}"
    return client.websocket_connect(f"/api/projects/{p['id']}/ws", headers=hdrs)


def test_anonymous_receives_created_updated_deleted(api, alice):
    p = api.project(alice)
    with connect(api, p) as ws:
        created = api.measure(p, alice, note="neu").json()
        event = ws.receive_json()
        assert event["type"] == "measurement.created"
        assert event["measurement"]["id"] == created["id"]
        assert "edit_token" not in event["measurement"]

        base = f"/projects/{p['id']}/measurements/{created['id']}"
        api.patch(base, alice, json={"note": "geändert"})
        event = ws.receive_json()
        assert event["type"] == "measurement.updated" and event["measurement"]["note"] == "geändert"

        api.delete(base, alice)
        assert ws.receive_json() == {"type": "measurement.deleted", "measurement_id": created["id"]}


def test_hidden_events_differ_by_role(api, alice):
    p = api.project(alice)
    m = api.measure(p).json()
    base = f"/projects/{p['id']}/measurements/{m['id']}"
    with connect(api, p) as anon_ws, connect(api, p, alice) as member_ws:
        api.patch(base, alice, json={"hidden": True})
        assert member_ws.receive_json() == {"type": "measurement.hidden", "measurement_id": m["id"]}
        assert anon_ws.receive_json() == {"type": "measurement.deleted", "measurement_id": m["id"]}

        api.patch(base, alice, json={"hidden": False})
        assert member_ws.receive_json()["type"] == "measurement.updated"
        assert anon_ws.receive_json()["type"] == "measurement.created"

        api.patch(base, alice, json={"hidden": True})
        member_ws.receive_json()
        anon_ws.receive_json()
        api.patch(base, alice, json={"note": "still"})  # betrifft nur Moderatoren
        assert member_ws.receive_json()["type"] == "measurement.updated"
        api.measure(p)  # nächstes Ereignis für Anonyme beweist: die Änderung kam nicht an
        assert anon_ws.receive_json()["type"] == "measurement.created"


def test_project_events(api, alice):
    p = api.project(alice)
    with connect(api, p) as ws:
        api.patch(f"/projects/{p['id']}", alice, json={"name": "umbenannt"})
        event = ws.receive_json()
        assert event["type"] == "project.updated" and event["project"]["name"] == "umbenannt"
        api.put(f"/projects/{p['id']}/archive", alice)
        assert ws.receive_json() == {"type": "project.archived"}


def test_metric_change_notifies_clients(api, alice):
    p = api.project(alice)
    with connect(api, p) as ws:
        api.post(
            f"/projects/{p['id']}/metrics",
            alice,
            json={"name": "CO2", "type": "number", "min": 300, "max": 5000},
        )
        assert ws.receive_json()["type"] == "project.updated"


def test_private_project_rejects_outsiders(api, alice, bob):
    p = api.project(alice, is_public=False)
    for actor in (None, bob):
        with pytest.raises(WebSocketDisconnect) as exc, connect(api, p, actor) as ws:
            ws.receive_json()
        assert exc.value.code == 1008
    with connect(api, p, alice) as ws:
        api.measure(p, alice)
        assert ws.receive_json()["type"] == "measurement.created"


def test_going_private_disconnects_outsiders_only(api, alice):
    p = api.project(alice)
    with connect(api, p) as anon_ws, connect(api, p, alice) as member_ws:
        api.patch(f"/projects/{p['id']}", alice, json={"is_public": False})
        assert member_ws.receive_json()["type"] == "project.updated"
        with pytest.raises(WebSocketDisconnect):
            anon_ws.receive_json()


def test_unknown_project_is_rejected(api):
    with (
        pytest.raises(WebSocketDisconnect),
        api.client.websocket_connect("/api/projects/gibt-es-nicht/ws") as ws,
    ):
        ws.receive_json()


def test_cross_origin_cookie_connections_are_rejected(api, alice):
    p = api.project(alice, is_public=False)
    with (
        pytest.raises(WebSocketDisconnect),
        connect(api, p, alice, headers={"origin": "https://evil.example"}) as ws,
    ):
        ws.receive_json()
    with connect(api, p, alice, headers={"origin": "https://testserver"}) as ws:
        ws.send_text("ping")  # Pings sind erlaubt und werden ignoriert


def test_allowed_origin_setting(make_api):
    api = make_api(allowed_origins=["https://karte.example"])
    alice = api.register("alice")
    p = api.project(alice, is_public=False)
    with connect(api, p, alice, headers={"origin": "https://karte.example"}) as ws:
        api.measure(p, alice)
        assert ws.receive_json()["type"] == "measurement.created"


def test_write_scoped_token_cannot_listen(api, alice):
    p = api.project(alice)
    token = api.post("/tokens", alice, json={"name": "s", "scope": "measurements:write"}).json()
    sensor = Actor()
    sensor.bearer = token["token"]
    with pytest.raises(WebSocketDisconnect), connect(api, p, sensor) as ws:
        ws.receive_json()


def test_deleting_project_closes_connections(api, alice):
    p = api.project(alice)
    with connect(api, p) as ws:
        api.delete(f"/projects/{p['id']}", alice)
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
