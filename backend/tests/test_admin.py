from tests.conftest import PASSWORD


def test_admin_endpoints_forbidden_for_others(api, alice):
    new_user = {"username": "zzz", "password": PASSWORD}
    for method, path, body in (
        ("GET", "/admin/users", None),
        ("POST", "/admin/users", new_user),
        ("GET", "/admin/settings", None),
        ("PATCH", "/admin/settings", {"registration_enabled": False}),
    ):
        assert api.request(method, path, alice, json=body).status_code == 403, (method, path)
        assert api.request(method, path, json=body).status_code == 401, (method, path)
    assert api.patch(f"/admin/users/{alice.id}", alice, json={"is_admin": True}).status_code == 403
    assert api.delete(f"/admin/users/{alice.id}", alice).status_code == 403
    assert api.get("/me", alice).json()["user"]["is_admin"] is False


def test_list_and_search_users(api, admin, alice, bob):
    r = api.get("/admin/users", admin).json()
    assert r["total"] == 3
    assert [u["username"] for u in r["items"]] == ["alice", "bob", "root"]
    assert [
        u["username"] for u in api.get("/admin/users", admin, params={"q": "ali"}).json()["items"]
    ] == ["alice"]
    assert (
        api.get("/admin/users", admin, params={"q": "%"}).json()["total"] == 0
    )  # Wildcards maskiert
    assert len(api.get("/admin/users", admin, params={"limit": 1}).json()["items"]) == 1


def test_admin_creates_user_even_if_registration_disabled(api, admin):
    api.patch("/admin/settings", admin, json={"registration_enabled": False})
    r = api.post(
        "/admin/users", admin, json={"username": "neu", "password": PASSWORD, "is_admin": True}
    )
    assert r.status_code == 201 and r.json()["is_admin"] is True
    assert (
        api.post("/admin/users", admin, json={"username": "NEU", "password": PASSWORD}).status_code
        == 409
    )
    api.login("neu")


def test_admin_password_reset_invalidates_sessions(api, admin, alice):
    r = api.patch(f"/admin/users/{alice.id}", admin, json={"new_password": "brand-new-password"})
    assert r.status_code == 200
    assert api.get("/me", alice).json()["user"] is None
    assert (
        api.post("/auth/login", json={"username": "alice", "password": PASSWORD}).status_code == 401
    )
    api.login("alice", "brand-new-password")
    short = api.patch(f"/admin/users/{alice.id}", admin, json={"new_password": "kurz"})
    assert short.status_code == 422


def test_admin_can_manage_any_project_and_members(api, admin, alice, bob):
    p = api.project(alice, is_public=False)
    url = f"/projects/{p['id']}"
    assert api.post(f"{url}/members", admin, json={"username": "bob"}).status_code == 201
    assert api.patch(f"{url}/members/{bob.id}", admin, json={"role": "owner"}).status_code == 200
    assert api.get(f"{url}/members", admin).status_code == 200
    assert api.measure(p, admin).status_code == 201
    assert api.get("/projects", admin, params={"scope": "all"}).json()["total"] == 1


def test_last_admin_is_protected(api, admin):
    me = admin.id
    assert (
        api.patch(f"/admin/users/{me}", admin, json={"is_admin": False}).json()["code"]
        == "last_admin"
    )
    assert api.patch(f"/admin/users/{me}", admin, json={"is_active": False}).status_code == 409
    assert api.delete(f"/admin/users/{me}", admin).status_code == 409
    second = api.post(
        "/admin/users", admin, json={"username": "zweit", "password": PASSWORD, "is_admin": True}
    )
    assert api.patch(f"/admin/users/{me}", admin, json={"is_admin": False}).status_code == 200
    assert second.status_code == 201


def test_delete_user_keeps_measurements_and_projects(api, admin, alice, bob):
    p = api.project(bob)
    api.post(f"/projects/{p['id']}/members", bob, json={"username": "alice"})
    m = api.measure(p, alice).json()
    assert api.delete(f"/admin/users/{alice.id}", admin).status_code == 204
    items = api.get(f"/projects/{p['id']}/measurements").json()["items"]
    assert [i["id"] for i in items] == [m["id"]]
    assert api.delete(f"/admin/users/{alice.id}", admin).status_code == 404
    assert api.delete(f"/admin/users/{bob.id}", admin).status_code == 204


def test_settings_roundtrip(api, admin):
    assert api.get("/admin/settings", admin).json() == {"registration_enabled": True}
    assert api.patch("/admin/settings", admin, json={"registration_enabled": False}).json() == {
        "registration_enabled": False
    }
    assert api.patch("/admin/settings", admin, json={}).json() == {"registration_enabled": False}
    api.patch("/admin/settings", admin, json={"registration_enabled": True})
    assert api.get("/me").json()["registration_enabled"] is True


def test_bootstrap_admin_from_environment(make_api):
    api = make_api(admin_username="chef", admin_password=PASSWORD)
    chef = api.login("chef")
    assert api.get("/me", chef).json()["user"]["is_admin"] is True
    assert api.get("/admin/users", chef).status_code == 200
