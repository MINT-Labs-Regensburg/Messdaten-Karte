# Messdaten Karte – Frontend

React 18, Vite, TypeScript, Leaflet, TanStack Query, react-i18next. Fachliche Beschreibung: `../projekt.md`, API: `../openapi.yaml`.

## Entwicklung

Node 22 und npm sind nötig (alternativ im Container, siehe unten).

```bash
npm ci
npm run dev        # http://localhost:5173, /api (inkl. WebSocket) geht an das Backend auf Port 8000
npm run typecheck
npm test
npm run build      # Ausgabe in dist/
```

Ohne lokales Node, mit Docker:

```bash
docker run --rm -u $(id -u):$(id -g) -v "$PWD:/app" -w /app -e HOME=/tmp node:22-alpine sh -c "npm ci && npm run typecheck && npm test && npm run build"
```

## Aufbau

- `src/api` – API-Client (CSRF-Header, Fehlercodes) und Typen
- `src/auth` – Anmeldung (Session-Cookie), Routen-Wächter
- `src/pages` – Seiten, `src/components` – gemeinsame Bausteine
- `src/map` – Karte, Heatmap-Overlay, Zeitleiste/Replay, Eintragen-Formular, Live-Anbindung
- `src/lib` – Zeitbereich, Farbskalen, Geometrie, Browser-Speicher
- `src/i18n` – Übersetzungen (`de.json`, `en.json`); keine hartkodierten Texte in Komponenten
- `src/styles` – Design-Tokens und Stile

## Betrieb

Das `Dockerfile` baut die App und liefert sie mit nginx aus (`nginx.conf`: SPA-Fallback, Proxy für `/api` inklusive WebSocket). Start über das Compose-Profil `frontend` im Projektwurzelverzeichnis.
