# Messdaten Karte: Projektregeln

Fachliche Beschreibung: `projekt.md`. API-Entwurf: `openapi.yaml`. Bei Änderungen an Verhalten oder API beides mitpflegen.

## Code-Formatierung
- Python wird ausschließlich mit **ruff** formatiert und geprüft (`ruff format` und `ruff check`). Keine anderen Formatter (black, isort, flake8).
- Die ruff-Konfiguration steht zentral in `pyproject.toml`; Regeln nicht per `# noqa` umgehen, außer mit kurzer Begründung im Kommentar.

## Vor jedem Commit
1. `ruff format .`
2. `ruff check .` (ohne Fehler; `--fix` ist erlaubt, das Ergebnis danach prüfen)
3. Alle Tests ausführen (`pytest`); **alle müssen grün sein**.

Ein Commit mit Ruff-Fehlern oder fehlschlagenden Tests wird nicht erstellt. Tests dürfen dafür nicht übersprungen, gelöscht oder abgeschwächt werden. Bei einem Fehlschlag zuerst die Ursache beheben.

## Tests
- Jeder neue Code und jede Änderung am Verhalten bekommt Tests im selben Commit. Ein Bugfix beginnt mit einem Test, der den Fehler reproduziert.
- Backend: `pytest`. Besonders abzudecken: Berechtigungsmatrix (anonym, angemeldet, Mitglied, Admin), Validierung (Kreis, Min/Max, Typen), Edit-Token-Fenster, API-Token-Scopes, Limits, Archivierung, Kriging-Randfälle (zu wenige Punkte, identische Koordinaten, konstante Werte) und WebSocket-Ereignisse.
- Tests laufen gegen eine eigene Test-Datenbank, nie gegen Produktivdaten, und sind unabhängig voneinander.
- Frontend: Tests für zentrale Abläufe (Eintragen, Zeitbereich, Login).
- Nur Verhalten testen, das nicht trivial ist; Tests dürfen nicht von externen Diensten (OSM, Esri) abhängen.

## Allgemein
- Keine Secrets im Repository; Konfiguration über Umgebungsvariablen.
- Oberflächentexte nur über Übersetzungsdateien (DE und EN), nie hartkodiert.
