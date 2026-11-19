import time
from collections import deque

from app.errors import ApiError


class RateLimiter:
    """Einfaches Sliding-Window-Limit im Arbeitsspeicher (ein Prozess, Homelab-Maßstab)."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}

    def _prune(self, key: str, window: float, now: float) -> deque[float]:
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] <= now - window:
            hits.popleft()
        if not hits:
            self._hits.pop(key, None)
            return deque()
        return hits

    def check(self, key: str, limit: int, window: float) -> None:
        """Wirft 429, wenn das Limit erreicht ist (zählt nicht mit)."""
        now = time.monotonic()
        hits = self._prune(key, window, now)
        if len(hits) >= limit:
            retry = max(1, int(hits[0] + window - now) + 1)
            raise ApiError(
                429,
                "rate_limited",
                "Too many requests",
                headers={"Retry-After": str(retry)},
            )

    def add(self, key: str, window: float) -> None:
        now = time.monotonic()
        self._prune(key, window, now)
        self._hits.setdefault(key, deque()).append(now)

    def hit(self, key: str, limit: int, window: float) -> None:
        self.check(key, limit, window)
        self.add(key, window)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)
