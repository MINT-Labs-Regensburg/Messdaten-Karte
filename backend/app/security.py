import hashlib
import hmac
import secrets
import time
from typing import Any

from itsdangerous import BadSignature, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

SESSION_COOKIE = "session"
API_TOKEN_PREFIX = "mdk_"  # noqa: S105 - öffentliches Präfix, kein Geheimnis

# Für Logins mit unbekanntem Benutzer, damit die Antwortzeit nichts verrät.
_DUMMY_HASH_CACHE: dict[str, str] = {}


def hash_password(password: str, method: str) -> str:
    return generate_password_hash(password, method=method)


def verify_password(password_hash: str, password: str) -> bool:
    return check_password_hash(password_hash, password)


def dummy_verify(password: str, method: str) -> None:
    if method not in _DUMMY_HASH_CACHE:
        _DUMMY_HASH_CACHE[method] = generate_password_hash(secrets.token_hex(8), method=method)
    check_password_hash(_DUMMY_HASH_CACHE[method], password)


def hash_token(token: str) -> str:
    """SHA-256 reicht für zufällige Tokens mit hoher Entropie."""
    return hashlib.sha256(token.encode()).hexdigest()


def new_api_token() -> tuple[str, str, str]:
    """Liefert (Klartext, Hash, Prefix)."""
    token = API_TOKEN_PREFIX + secrets.token_urlsafe(32)
    return token, hash_token(token), token[:8]


def new_edit_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(24)
    return token, hash_token(token)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(24)


def tokens_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


class SessionSigner:
    def __init__(self, secret_key: str):
        self._serializer = URLSafeTimedSerializer(secret_key, salt="messdaten-session")

    def dumps(self, data: dict[str, Any]) -> str:
        return self._serializer.dumps(data)

    def loads(self, value: str, max_age: int) -> dict[str, Any] | None:
        try:
            data = self._serializer.loads(value, max_age=max_age)
        except BadSignature:
            return None
        return data if isinstance(data, dict) else None


def now_ts() -> int:
    return int(time.time())
