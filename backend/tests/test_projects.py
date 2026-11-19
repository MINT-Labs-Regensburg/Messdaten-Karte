import uuid

from tests.conftest import CENTER


def test_create_project_defaults_and_slug(api, alice):
    p = api.project(alice, name="Mein Gebiet Ä/Ö!")
    assert p["slug"] == "mein-gebiet-a-o"
    assert p["my_role"] == "owner"
    assert p["archived"] is False
    p2 = api.project(alice, name="Mein Gebiet Ä/Ö!")
    assert p2["slug"] == "mein-gebiet-a-o-2"


def test_addressing_by_uuid_and_slug(api, alice):
    p = api.project(alice)
    assert api.get(f"/projects/{p['id']}").json()["id"] == p["id"]
    assert api.get(f"/projects/{p['slug']}").json()["id"] == p["id"]
    assert api.get(f"/projects/{uuid.uuid4()}").status_code == 404
    assert api.get("/projects/unbekannt").status_code == 404


def test_explicit_slug_conflict_and_uuid_like_slug(api, alice):
    api.project(alice, slug="mein-slug")
    r = api.post(
        "/projects",
        alice,
        json={"name": "x", "slug": "mein-slug", "center": CENTER, "radius_m": 10},
    )
    assert r.status_code == 409 and r.json()["code"] == "slug_taken"
    r = api.post(
        "/projects",
        alice,
        json={"name": "x", "slug": str(uuid.uuid4()), "center": CENTER, "radius_m": 10},
    )
    assert r.status_code == 422 and r.json()["code"] == "invalid_slug"


def test_radius_limit(make_api):
    api = make_api(max_radius_m=1000)
    alice = api.register("alice")
    r = api.post("/projects", alice, json={"name": "x", "center": CENTER, "radius_m": 1001})
    assert r.status_code == 422 and r.json()["code"] == "radius_too_large"
    p = api.project(alice, radius_m=1000)
    r = api.patch(f"/projects/{p['id']}", alice, json={"radius_m": 1500})
    assert r.status_code == 422


def test_create_validation(api, alice):
    for body in (
        {"name": "", "center": CENTER, "radius_m": 10},
        {"name": "x", "center": {"lat": 91, "lon": 0}, "radius_m": 10},
        {"name": "x", "center": CENTER, "radius_m": 0},
        {"name": "x", "center": CENTER, "radius_m": 10, "slug": "Ungültig Groß"},
    ):
        assert api.post("/projects", alice, json=body).status_code == 422


def test_private_project_is_invisible_to_outsiders(api, alice, bob, admin):
    p = api.project(alice, is_public=False, is_editable=False)
    url = f"/projects/{p['id']}"
    assert api.get(url).status_code == 404  # anonym
    assert api.get(url, bob).status_code == 404  # angemeldet, kein Mitglied
    assert api.get(url, alice).status_code == 200  # Mitglied
    assert api.get(url, admin).status_code == 200  # Admin
    assert api.get(url + "/metrics").status_code == 404
    assert api.get(url + "/measurements").status_code == 404
    assert api.get(url + "/heatmap", params={"metric": str(uuid.uuid4())}).status_code == 404


def test_public_project_visible_to_everyone(api, alice, bob):
    p = api.project(alice, is_editable=False)
    assert api.get(f"/projects/{p['id']}").status_code == 200
    detail = api.get(f"/projects/{p['id']}", bob).json()
    assert detail["my_role"] is None
    assert [m["name"] for m in detail["metrics"]] == ["Temperatur", "Wohlbefinden"]


def test_create_requires_login(api):
    r = api.post("/projects", json={"name": "x", "center": CENTER, "radius_m": 10})
    assert r.status_code == 401


def test_update_permissions(api, alice, bob, admin):
    p = api.project(alice)
    url = f"/projects/{p['id']}"
    assert api.patch(url, json={"name": "neu"}).status_code == 401
    assert api.patch(url, bob, json={"name": "neu"}).status_code == 403
    assert api.patch(url, alice, json={"name": "neu"}).json()["name"] == "neu"
    assert api.patch(url, admin, json={"name": "admin"}).json()["name"] == "admin"


def test_patch_null_rules(api, alice):
    p = api.project(alice, description="alt")
    url = f"/projects/{p['id']}"
    assert api.patch(url, alice, json={"description": None}).json()["description"] is None
    assert api.patch(url, alice, json={"name": None}).status_code == 422
    assert api.patch(url, alice, json={"radius_m": None}).status_code == 422


def test_geometry_change_blocked_by_existing_measurements(api, alice):
    p = api.project(alice)
    url = f"/projects/{p['id']}"
    far = {"lat": CENTER["lat"] + 0.004, "lon": CENTER["lon"]}  # ~445 m nördlich
    assert api.measure(p, alice, **far).status_code == 201
    r = api.patch(url, alice, json={"radius_m": 300})
    assert r.status_code == 409 and r.json()["code"] == "measurements_outside_circle"
    assert api.get(url).json()["radius_m"] == 500  # nichts geändert
    r = api.patch(url, alice, json={"radius_m": 800})
    assert r.status_code == 200
    r = api.patch(url, alice, json={"center": {"lat": CENTER["lat"] + 0.02, "lon": CENTER["lon"]}})
    assert r.status_code == 409


def test_delete_permissions(api, alice, bob, admin):
    p = api.project(alice)
    url = f"/projects/{p['id']}"
    api.post(url + "/members", alice, json={"username": "bob", "role": "editor"})
    assert api.delete(url).status_code == 401
    assert api.delete(url, bob).status_code == 403  # Editor darf nicht löschen
    assert api.delete(url, alice).status_code == 204
    assert api.get(url).status_code == 404
    p = api.project(alice)
    assert api.delete(f"/projects/{p['id']}", admin).status_code == 204


def test_archive_and_reactivate(api, alice, bob):
    p = api.project(alice)
    url = f"/projects/{p['id']}"
    assert api.put(url + "/archive", bob).status_code == 403
    assert api.put(url + "/archive", alice).status_code == 204
    assert api.get(url).json()["archived"] is True
    assert api.measure(p).status_code == 409  # anonym
    assert api.measure(p, alice).status_code == 409  # auch Mitglieder
    assert api.delete(url + "/archive", bob).status_code == 403
    assert api.delete(url + "/archive", alice).status_code == 204
    assert api.measure(p).status_code == 201


def test_archive_via_api_token_is_rejected_too(api, alice):
    p = api.project(alice)
    token = api.post("/tokens", alice, json={"name": "esp", "scope": "measurements:write"}).json()[
        "token"
    ]
    api.put(f"/projects/{p['id']}/archive", alice)
    from tests.conftest import Actor

    sensor = Actor()
    sensor.bearer = token
    r = api.measure(p, sensor)
    assert r.status_code == 409 and r.json()["code"] == "project_archived"


def test_list_scopes(api, alice, bob, admin):
    mine = api.project(alice, name="Alices", is_public=False)
    pub = api.project(bob, name="Bobs", is_public=True)
    api.put(f"/projects/{api.project(alice, name='Alt')['id']}/archive", alice)

    names = lambda r: {p["name"] for p in r.json()["items"]}  # noqa: E731
    assert names(api.get("/projects", alice)) == {"Alices"}
    assert names(api.get("/projects", alice, params={"scope": "public"})) == {"Alices", "Bobs"}
    assert names(api.get("/projects", alice, params={"archived": "true"})) == {"Alt"}
    assert names(api.get("/projects", params={"scope": "public"})) == {"Bobs"}  # anonym
    assert api.get("/projects").status_code == 401
    assert api.get("/projects", alice, params={"scope": "all"}).status_code == 403
    assert names(api.get("/projects", admin, params={"scope": "all"})) == {"Alices", "Bobs"}
    r = api.get("/projects", alice, params={"scope": "public", "limit": 1})
    assert r.json()["total"] == 2 and len(r.json()["items"]) == 1
    assert {mine["id"], pub["id"]} >= {i["id"] for i in r.json()["items"]}


def test_project_detail_has_measurement_range(api, alice):
    p = api.project(alice)
    assert api.get(f"/projects/{p['id']}").json()["first_measurement_at"] is None
    api.measure(p)
    detail = api.get(f"/projects/{p['id']}").json()
    assert detail["measurement_count"] == 1
    assert detail["first_measurement_at"] == detail["last_measurement_at"]


# ----------------------------------------------------------------- Mitglieder


def test_member_management(api, alice, bob):
    p = api.project(alice)
    url = f"/projects/{p['id']}/members"
    assert api.get(url, bob).status_code == 403
    assert api.post(url, bob, json={"username": "bob"}).status_code == 403

    r = api.post(url, alice, json={"username": "BOB", "role": "editor"})
    assert r.status_code == 201 and r.json()["username"] == "bob"
    assert api.post(url, alice, json={"username": "bob"}).status_code == 409
    assert api.post(url, alice, json={"username": "niemand"}).status_code == 404

    members = api.get(url, bob).json()  # Mitglied darf lesen
    assert [(m["username"], m["role"]) for m in members] == [("alice", "owner"), ("bob", "editor")]

    # Editor darf bearbeiten, aber keine Mitglieder verwalten
    assert api.patch(f"/projects/{p['id']}", bob, json={"name": "von bob"}).status_code == 200
    assert api.patch(f"{url}/{alice.id}", bob, json={"role": "editor"}).status_code == 403
    assert api.delete(f"{url}/{alice.id}", bob).status_code == 403


def test_last_owner_is_protected(api, alice, bob):
    p = api.project(alice)
    url = f"/projects/{p['id']}/members"
    api.post(url, alice, json={"username": "bob", "role": "editor"})
    r = api.patch(f"{url}/{alice.id}", alice, json={"role": "editor"})
    assert r.status_code == 409 and r.json()["code"] == "last_owner"
    assert api.delete(f"{url}/{alice.id}", alice).status_code == 409
    assert api.patch(f"{url}/{bob.id}", alice, json={"role": "owner"}).status_code == 200
    assert api.delete(f"{url}/{alice.id}", alice).status_code == 204
    assert api.get(f"/projects/{p['id']}", alice).json()["my_role"] is None


def test_removed_member_loses_private_access(api, alice, bob):
    p = api.project(alice, is_public=False)
    url = f"/projects/{p['id']}"
    api.post(url + "/members", alice, json={"username": "bob"})
    assert api.get(url, bob).status_code == 200
    api.delete(f"{url}/members/{bob.id}", alice)
    assert api.get(url, bob).status_code == 404
