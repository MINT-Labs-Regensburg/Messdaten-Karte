# Messdaten Karte

> Legende: **[Entscheidung]** = von Mario festgelegt, **[Vorschlag]** = Annahme von Claude, bitte prüfen.

## Zweck

Messdaten Karte ist eine Fullstack-Webanwendung (FastAPI-Backend, React-Frontend), mit der mehrere Personen gemeinsam **ortsbezogene Messwerte** (z. B. Temperatur, Luftfeuchtigkeit, Feinstaub, Wohlbefinden) in einem **kreisförmigen Zielgebiet** erfassen. Die Messpunkte erscheinen live auf einer Leaflet-Karte; aus ihnen wird pro Messgröße eine **interpolierte Farbkarte (Heatmap)** berechnet, um Hotspots und Coldspots zu sehen.

Typischer Ablauf:

1. Ein angemeldeter Benutzer legt ein **Projekt** an (Name, Mittelpunkt, Radius, Liste der Messgrößen).
2. Er teilt den **Link oder QR-Code** der öffentlichen Karte.
3. Beliebige Personen öffnen die Karte (auch ohne Konto), klicken im Kreis auf die Karte (oder nutzen „Mein Standort“) und tragen Werte ein.
4. Alle offenen Karten aktualisieren sich live; die Heatmap wird neu berechnet.
5. IoT-Geräte (z. B. ESP32) können per API-Token automatisch Messwerte senden.

### Nicht-Ziele [Vorschlag]
- Keine Routen-/Track-Aufzeichnung, nur Punktmessungen.
- Keine native App; mobile Nutzung über responsive Web-App.
- Keine Echtzeit-Skalierung auf tausende gleichzeitige Nutzer (Homelab-Maßstab).

## Technik

| Bereich | Umsetzung |
|---|---|
| Backend | Python 3.14 (3.15 ist noch Alpha), FastAPI, Paketverwaltung mit uv (`backend/pyproject.toml`) |
| Datenbank | PostgreSQL 15 über SQLAlchemy, Migrationen mit Alembic [Vorschlag] |
| Authentifizierung | Session-Cookie (Starlette `SessionMiddleware` o. ä., „Remember me“), Pydantic, Passwort-Hashes via Werkzeug (`generate_password_hash`) |
| Frontend | React mit **Vite** statt Create React App (CRA ist unmaintained) [Entscheidung] |
| Karte | Leaflet / react-leaflet |
| Karten-Kacheln | OpenStreetMap („Straßenkarte“) und Esri World Imagery („Satellit“); Attribution beachten |
| Live-Updates | WebSockets (FastAPI), ein Kanal pro Projekt |
| Interpolation | **Kriging** im Backend (z. B. `pykrige`) [Entscheidung] |
| QR-Codes | Im Frontend mit `qrcode.react` (kein Backend nötig) [Vorschlag] |
| Deployment | Docker Compose: Backend, Frontend (nginx), PostgreSQL; hinter bestehendem Reverse Proxy (`hz-haproxy`) [Entscheidung] |

## Rollen und Berechtigungen

- **Projektrolle**: Ist ein Benutzer einem Projekt hinzugefügt, kann er das Projekt bearbeiten (Einstellungen, Messgrößen, Mitglieder-Moderation). [Vorschlag: Rollen `owner` (Ersteller, kann Mitglieder verwalten und Projekt löschen) und `editor`.]
- **Admin**: verwaltet alle Projekte und Benutzer, kann Benutzer zu Projekten hinzufügen/entfernen und die Registrierung ein-/ausschalten.
- **Anonym** (nicht angemeldet):
  - Projekt *öffentlich + bearbeitbar*: sehen und Messungen hinzufügen.
  - Projekt *öffentlich, nicht bearbeitbar*: nur ansehen.
  - Nicht öffentliche Projekte sind für Anonyme nicht erreichbar (404).
  - Anonyme können keine Projekte erstellen oder bearbeiten.
- **Registrierung**: jeder kann sich registrieren, solange sie aktiviert ist.

| Aktion | Anonym | Angemeldet (kein Mitglied) | Projektmitglied | Admin |
|---|---|---|---|---|
| Öffentliches Projekt ansehen | ✔ | ✔ | ✔ | ✔ |
| Messung hinzufügen (bearbeitbar) | ✔ | ✔ | ✔ | ✔ |
| Eigene Messung ändern/löschen | ✔ (Edit-Token) | ✔ | ✔ | ✔ |
| Fremde Messung ausblenden/löschen | ✘ | ✘ | ✔ | ✔ |
| Projekt anlegen | ✘ | ✔ | ✔ | ✔ |
| Projekt bearbeiten | ✘ | ✘ | ✔ | ✔ |
| Benutzer verwalten, Registrierung steuern | ✘ | ✘ | ✘ | ✔ |

## Authentifizierung

**[Entscheidung]** Die öffentliche Kartenansicht ist ohne Login erreichbar; Projektverwaltung, Profil und Admin-Bereich erfordern Login (der frühere Satz „Frontend nur für angemeldete Benutzer“ galt nur für diesen Verwaltungsbereich).

- Login setzt ein Session-Cookie (`HttpOnly`, `Secure`, `SameSite=Lax`); „Remember me“ verlängert die Laufzeit.
- CSRF-Schutz für cookie-authentifizierte, zustandsändernde Requests [Vorschlag: Double-Submit-Token oder Origin-Prüfung].
- Login-Rate-Limit gegen Brute-Force [Vorschlag].
- **API-Tokens** [Entscheidung]: Benutzer erzeugen Tokens für externe Anwendungen und IoT-Geräte.
  - Zwei Scopes: `measurements:write` (einfach für Sensoren) und `full` (voller API-Zugriff mit den Rechten des Benutzers).
  - Optional auf ein Projekt beschränkbar [Vorschlag].
  - Übertragung per `Authorization: Bearer <token>`; in der DB nur als Hash gespeichert, Klartext wird einmalig bei Erstellung angezeigt.
  - Widerruf, Name, „zuletzt benutzt“ in der UI.

## Datenmodell (Entwurf) [Vorschlag]

- **User**: id, Benutzername (eindeutig), Passwort-Hash, `is_admin`, erstellt am.
- **Project**: id, Slug (für Link), Name, Mittelpunkt (lat/lon), Radius (m), `is_public`, `is_editable`, Ersteller.
- **ProjectMember**: Project, User, Rolle.
- **Metric** (Messgröße, frei pro Projekt) [Entscheidung]: Name, Einheit, Typ (Zahl oder Skala, z. B. 1–10 für Wohlbefinden), Min/Max (Plausibilitätsgrenzen), Farbskala, Reihenfolge.
- **Measurement**: id, Project, lat/lon, Zeitstempel (Server-Zeit; bei API optional vom Gerät), Autor (User, API-Token oder anonym), optionaler Name/Notiz, `hidden`, `edit_token_hash` (für anonyme Änderung).
- **MeasurementValue**: Measurement, Metric, Wert. (Eine Messung = ein Punkt mit mehreren Werten.)
- **ApiToken**: User, Name, Hash, Scope, optional Project, zuletzt benutzt, widerrufen.
- **Setting**: u. a. `registration_enabled`.

## Messungen

- **Eintragen** [Entscheidung]: Klick auf die Karte oder Button „Mein Standort“ (Geolocation); ein Formular erfasst mehrere Messgrößen gleichzeitig plus optionalem Namen/Notiz. Auf dem Handy bedienbar.
- **Validierung serverseitig** [Entscheidung]: Punkt muss im Projektkreis liegen; Wert muss innerhalb der Min/Max-Grenzen der Messgröße liegen; Typprüfung. Verstöße → 422.
- **Spam-Schutz** [Entscheidung/Vorschlag]: Plausibilitätsgrenzen und Kreisprüfung (beschlossen); Projektmitglieder können Messungen ausblenden oder löschen (beschlossen); zusätzlich einfaches Rate-Limit pro IP für anonyme Eintragungen [Vorschlag, nicht gewählt, aber günstig].
- **Anonyme Änderung** [Entscheidung]: Beim Anlegen erhält der Browser einen zufälligen Edit-Token (localStorage); damit kann die Person ihre Messung kurz ändern oder löschen. Zeitfenster z. B. 15 min [Vorschlag].

## Zeitleiste und Replay [Entscheidung]

- Jede Messung hat einen Zeitstempel; die Heatmap kann für einen **frei wählbaren Zeitbereich** berechnet werden („von … bis …“, plus Schnellwahl wie letzte Stunde/Tag).
- Der gewählte Zeitbereich ist **immer sichtbar als Kontext** in der Oberfläche und Teil der API-Abfrage und der URL (teilbar).
- **Replay**: Zeitschieberegler mit Play/Pause, der die Karte schrittweise durch den Zeitbereich führt (Fenster fester Breite, das über den Bereich gleitet, oder kumulativ; Modus wählbar [Vorschlag]).
- Live-Updates fügen neue Messungen nur dann sichtbar hinzu, wenn sie in den gewählten Zeitbereich fallen.

## Heatmap / Kriging

- Berechnung im Backend pro Messgröße und Zeitbereich; Ergebnis als Gitter (Werte pro Zelle) oder als gefärbtes Overlay, das Leaflet über die Karte legt, begrenzt auf den Projektkreis.
- Kriging braucht mindestens einige Punkte (Vorschlag: ab 4–5; darunter nur Punktdarstellung oder IDW-Fallback) und kann bei identischen Koordinaten oder konstanten Werten fehlschlagen: diese Fälle abfangen.
- Mehrere Messungen am selben Ort aggregieren (Mittelwert) [Vorschlag].
- Ergebnisse cachen, Neuberechnung bei neuen Messungen entprellen (z. B. höchstens alle paar Sekunden pro Projekt+Messgröße), damit WebSocket-Updates das Backend nicht überlasten.
- Farbskala je Messgröße mit Legende (Min/Max, Einheit).

## Live-Updates

- WebSocket-Kanal pro Projekt; Server sendet Ereignisse: Messung hinzugefügt/geändert/ausgeblendet/gelöscht, Projekt geändert.
- Heatmap wird bei Ereignissen vom Client neu angefordert (oder Server schickt neues Gitter) [Vorschlag: Client holt neu, einfacher].
- Anonyme Verbindungen nur für öffentliche Projekte; Reconnect mit automatischem Nachladen.

## API (Grobentwurf) [Vorschlag]

- `POST /api/auth/login`, `/logout`, `/register`; `GET /api/me`
- `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/{id|slug}`
- `GET/POST /api/projects/{id}/measurements?from=&to=`, `PATCH/DELETE …/{mid}`
- `GET /api/projects/{id}/heatmap?metric=&from=&to=`
- `WS /api/projects/{id}/ws`
- `GET/POST/DELETE /api/tokens`
- Admin: `/api/admin/users`, `/api/admin/settings`
- OpenAPI-Doku automatisch über FastAPI; IoT-Beispiel (curl und ESP32-Snippet) in der Doku.

## Frontend-Seiten [Vorschlag]

- `/` Login/Startseite, `/register`
- `/p/{slug}` öffentliche Karte (Kartenwechsel Straße/Satellit, Messgrößen-Auswahl, Zeitleiste, Eintragen-Formular, QR/Link teilen)
- `/projects` eigene Projekte, `/projects/{id}/settings` (Kreis auf Karte setzen, Messgrößen, Mitglieder, Sichtbarkeit, Moderation)
- `/tokens` API-Tokens, `/admin` Benutzer, Projekte, Registrierung

## Betrieb und Qualität [Vorschlag]

- Docker Compose mit Healthchecks, Volumes für Postgres, Konfiguration über Umgebungsvariablen (`DATABASE_URL`, `SECRET_KEY`, …); keine Secrets im Repository.
- Reverse Proxy muss WebSockets durchreichen; HTTPS erforderlich (Geolocation und `Secure`-Cookies).
- Erster Admin wird per Umgebungsvariable oder CLI-Befehl angelegt.
- Backups: `pg_dump` bzw. Anbindung an den bestehenden PBS.
- Tests: pytest für Backend (Berechtigungsmatrix, Validierung, Kriging-Randfälle), Playwright oder Vitest für zentrale Frontend-Flows.
- Datenschutz: keine IP-Speicherung außer kurzfristig für Rate-Limits; Hinweis, dass Notiz/Name öffentlich sichtbar sind.

## Sprache [Entscheidung]

Oberfläche zweisprachig **Deutsch + Englisch** (z. B. `react-i18next`). Alle Texte von Anfang an in Übersetzungsdateien, keine hartkodierten Strings. Sprache nach Browser-Einstellung, manuell umschaltbar; API-Fehlermeldungen als Fehlercodes, die das Frontend übersetzt.

## Export [Entscheidung]

Vor jedem Export wählt der Nutzer, **welche Daten** enthalten sein sollen (Messgrößen, Zeitbereich, ausgeblendete Messungen ja/nein, Notizen/Namen ja/nein).

| Format | Inhalt | Stufe |
|---|---|---|
| CSV | Messungen, ein Wert pro Zeile oder Spalte je Messgröße | 1 |
| GeoJSON | Messpunkte mit Werten und Zeit als Properties | 1 |
| Kartenbild mit Heatmap | bevorzugt **SVG ohne Pixelgrafik** (Kriging-Gitter wird zu gefüllten Konturflächen/Isobandenpolygonen vektorisiert, z. B. mit `contourpy`/d3-contour); Hintergrundkarte nicht als Pixelkachel einbettbar → SVG zeigt Heatmap, Kreis, Messpunkte, Legende, Maßstab, optional ohne Basiskarte. Ist ein Basiskarten-Hintergrund gewünscht, Export als **PNG/JPEG mit vom Nutzer einstellbarer Auflösung** (Breite/Höhe oder DPI) | 1 |
| Gerendertes Video des Heatmap-Verlaufs | Replay-Zeitbereich als Video (z. B. MP4/WebM via ffmpeg, Server-seitig als Hintergrundjob) | **spätere Ausbaustufe** |

Hinweis [Vorschlag]: Bildexport läuft im Backend (Matplotlib/eigener SVG-Writer) oder im Browser; das Backend ist für das spätere Video ohnehin nötig und liefert reproduzierbare Ergebnisse, daher dort. Esri-/OSM-Kacheln haben Nutzungsbedingungen: Satellit-Export nur falls zulässig prüfen, Attribution im Bild.

## Projekt-Lebenszyklus [Entscheidung]

Projekte können **archiviert** werden (kein Ablaufdatum). Ein archiviertes Projekt bleibt gemäß Sichtbarkeit lesbar, nimmt aber keine Messungen mehr an (auch nicht per API) und kann von Mitgliedern wieder aktiviert werden. Löschen bleibt Owner/Admin vorbehalten.

## Messgrößen im Formular [Entscheidung]

Das Eintragen-Formular zeigt **immer alle Messgrößen** des Projekts; einzelne Werte dürfen leer bleiben (mindestens ein Wert nötig).

## Limits [Entscheidung]

- Projektradius maximal **5 km**, maximal **5.000 Messungen pro Projekt**; beides per Umgebungsvariable konfigurierbar.
- Bei großen Mengen (Kriging skaliert schlecht) Punkte vor der Berechnung auf ein Raster aggregieren oder eine Teilmenge nutzen [Vorschlag]; Berechnung mit Timeout.

## Registrierung [Entscheidung]

Registrierung mit **Benutzername + Passwort**, keine E-Mail, kein SMTP. Passwort-Reset nur durch einen Admin. Mindestanforderung an Passwörter und Rate-Limit beim Login [Vorschlag]. Der Datenmodell-Eintrag *User* hat entsprechend keine E-Mail-Pflicht (Benutzername eindeutig).

## Backend-Umsetzung (Stand 2026-11-19)

Festlegungen aus der Implementierung (Code in `backend/app/`, Start: `uvicorn app.main:create_app --factory`):

- **Async** durchgehend: SQLAlchemy `AsyncSession` mit psycopg3, `async def`-Endpoints; Kriging und Bildexport laufen per `asyncio.to_thread`. **[Entscheidung]**
- **Sessions**: signiertes Cookie (itsdangerous) mit Benutzer-ID, `session_version`, CSRF-Token und „remember“-Flag; ohne „Remember me“ ein Browser-Session-Cookie (serverseitig max. 12 h), mit 30 Tagen. Passwortänderung/-reset und Sperren erhöhen `session_version` und machen alle Cookies sofort ungültig. **[Entscheidung: signiertes Cookie]**
- **CSRF**: Header `X-CSRF-Token` ist Pflicht für zustandsändernde Requests mit Session-Cookie (nicht für Bearer-Tokens und nicht für anonyme Requests). WebSocket mit Cookie nur vom eigenen Origin (oder `ALLOWED_ORIGINS`).
- **Berechtigungen**: Nicht sichtbare Projekte liefern 404. Mitglieder und Admins dürfen immer Messungen hinzufügen (auch bei öffentlichen, nicht bearbeitbaren Projekten, z. B. für IoT); alle anderen nur bei *öffentlich + bearbeitbar* (sonst 403 `project_not_editable`). Archivierte Projekte lehnen jede Änderung an Messungen mit 409 `project_archived` ab (Moderation inklusive).
- **API-Tokens**: `measurements:write` darf nur Messungen anlegen (und `GET /me`); `full` hat die Rechte des Benutzers, aber ohne Token-Verwaltung (nur per Session). Projektgebundene Tokens funktionieren nur auf ihrem Projekt, nicht kontoweit. `measured_at` ist nur mit Token erlaubt (nicht in der Zukunft, 1 min Toleranz).
- **Letzter Owner/Admin** kann nicht entfernt, herabgestuft oder gesperrt werden (409 `last_owner` / `last_admin`).
- **Messgröße löschen** entfernt auch Messungen, die danach keinen Wert mehr hätten. Änderungen an Messgrößen senden `project.updated` (Clients laden das Projekt neu).
- **Heatmap**: Mittelung identischer Orte (1 m), IDW-Fallback bei zu wenigen Punkten für Kriging-Fit oder Fehlern, konstante Werte → konstantes Gitter, Verdichtung auf ein 30×30-Raster ab `HEATMAP_MAX_POINTS`, In-Memory-Cache mit Entprellung (`HEATMAP_MIN_INTERVAL_S`), Timeout `HEATMAP_TIMEOUT_S` (Status `failed`).
- **Rate-Limits** (Login, Registrierung, anonyme Messungen) liegen im Arbeitsspeicher: Das Backend läuft deshalb mit **einem** Worker-Prozess (gilt auch für Hub und Heatmap-Cache). Hinter einem Reverse Proxy `--proxy-headers` und `--forwarded-allow-ips` setzen, damit die Client-IP stimmt.
- **Export**: CSV (mit Schutz vor Formel-Injection) und GeoJSON; SVG (reine Vektorgrafik) sowie PNG/JPEG mit wählbarer Auflösung, jeweils ohne Basiskarte (`basemap` ≠ `none` → 422 `basemap_not_supported`, solange die Kachelnutzung nicht geklärt ist). Video noch nicht umgesetzt.
- **Erster Admin**: `ADMIN_USERNAME`/`ADMIN_PASSWORD` beim Start (legt nur an, falls nicht vorhanden) oder `python -m app.cli create-admin <name>`.
- **Tests**: laufen gegen eine Wegwerf-Postgres-Datenbank (`backend/compose.test.yaml`, Port 55432); das Schema entsteht per Alembic-Migration.

## Offene Fragen

Keine mehr aus der ersten Runde. Neue Punkte bei Bedarf hier ergänzen.
