#!/bin/sh
# Migrationen anwenden, dann den API-Server starten.
# Bewusst genau ein Worker: Rate-Limits, WebSocket-Hub und Heatmap-Cache liegen im Prozessspeicher.
set -eu

alembic upgrade head

exec uvicorn app.main:create_app --factory \
    --host 0.0.0.0 --port 8000 --workers 1 \
    --proxy-headers --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}"
