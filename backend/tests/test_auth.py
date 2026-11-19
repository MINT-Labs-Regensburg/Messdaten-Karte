from tests.conftest import PASSWORD, Actor


def test_register_login_logout_me(api):
    r = api.post("/auth/register", json={"username": "Alice", "password": PASSWORD})
    assert r.status_code == 201
    assert r.json()["username"] == "Alice"
    assert "password" not in r.text

    alice = api.login("Alice")
    me = api.get("/me", alice).json()
    assert me["user"]["username"] == "Alice"
    assert me["csrf_token"] == alice.csrf
    assert me["limits"]["max_radius_m"] == 5000

    assert api.post("/auth/logout", alice).status_code == 204
    assert api.get("/me", alice).json()["user"] is None


def test_me_anonymous(api):
    me = api.get("/me").json()
    assert me["user"] is None
    assert me["registration_enabled"] is True


def test_username_unique_case_insensitive(api, alice):
    r = api.post("/auth/register", json={"username": "ALICE", "password": PASSWORD})
    assert r.status_code == 409
    assert r.json()["code"] == "username_taken"


def test_register_validation(api):
    for body in (
        {"username": "ab", "password": PASSWORD},
        {"username": "bad name!", "password": PASSWORD},
        {"username": "carol", "password": "short"},
    ):
        r = api.post("/auth/register", json=body)
        assert r.status_code == 422
        assert r.json()["code"] == "validation_error"


def test_registration_disabled(api, admin):
    r = api.patch("/admin/settings", admin, json={"registration_enabled": False})
    assert r.status_code == 200
    r = api.post("/auth/register", json={"username": "dave", "password": PASSWORD})
    assert r.status_code == 403
    assert r.json()["code"] == "registration_disabled"
    assert api.get("/me").json()["registration_enabled"] is False


def test_login_wrong_password_and_unknown_user_look_the_same(api, alice):
    a = api.post("/auth/login", json={"username": "alice", "password": "wrong-password-1"})
    b = api.post("/auth/login", json={"username": "nobody", "password": "wrong-password-1"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_login_rate_limit(make_api):
    api = make_api(auth_rate_limit_count=3)
    api.register("alice")
    for _ in range(3):
        r = api.post("/auth/login", json={"username": "alice", "password": "wrong-password-1"})
        assert r.status_code == 401
    r = api.post("/auth/login", json={"username": "alice", "password": PASSWORD})
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) > 0


def test_csrf_required_for_session_writes(api, alice):
    r = api.post(
        "/projects",
        alice,
        csrf=False,
        json={"name": "x", "center": {"lat": 1, "lon": 1}, "radius_m": 10},
    )
    assert r.status_code == 403
    assert r.json()["code"] == "csrf_failed"
    wrong = Actor("alice")
    wrong.cookies, wrong.csrf = dict(alice.cookies), "not-the-token"
    r = api.post(
        "/projects", wrong, json={"name": "x", "center": {"lat": 1, "lon": 1}, "radius_m": 10}
    )
    assert r.status_code == 403


def test_csrf_not_needed_for_reads_or_anonymous(api, alice):
    assert api.get("/projects", alice, csrf=False).status_code == 200
    assert api.get("/me", alice, csrf=False).status_code == 200


def test_session_cookie_flags_and_remember_me(api, alice):
    r = api.client.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie
    assert "max-age" not in cookie

    r = api.client.post(
        "/api/auth/login", json={"username": "alice", "password": PASSWORD, "remember_me": True}
    )
    assert "max-age=2592000" in r.headers["set-cookie"].lower()


def test_tampered_cookie_is_anonymous(api, alice):
    fake = Actor("alice")
    fake.cookies = {"session": alice.cookies["session"][:-3] + "abc"}
    assert api.get("/me", fake).json()["user"] is None


def test_expired_session(make_api):
    api = make_api(session_max_age_s=-1)
    alice = api.register("alice")
    assert api.get("/me", alice).json()["user"] is None


def test_password_change_invalidates_other_sessions(api, alice):
    other = api.login("alice")
    r = api.patch(
        "/me", alice, json={"current_password": PASSWORD, "new_password": "another-long-password"}
    )
    assert r.status_code == 204
    assert api.get("/me", other).json()["user"] is None  # alte Session ungültig
    assert api.get("/me", alice).json()["user"]["username"] == "alice"  # aktuelle bleibt
    api.login("alice", "another-long-password")


def test_password_change_requires_current_password(api, alice):
    r = api.patch(
        "/me",
        alice,
        json={"current_password": "wrong-password-1", "new_password": "another-long-password"},
    )
    assert r.status_code == 401


def test_deactivated_user_loses_session_and_cannot_login(api, admin, alice):
    r = api.patch(f"/admin/users/{alice.id}", admin, json={"is_active": False})
    assert r.status_code == 200
    assert api.get("/me", alice).json()["user"] is None
    r = api.post("/auth/login", json={"username": "alice", "password": PASSWORD})
    assert r.status_code == 403
    assert r.json()["code"] == "account_disabled"


def test_unknown_route_uses_error_format(api):
    r = api.get("/does-not-exist")
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"
