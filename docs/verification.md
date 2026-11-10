# Verifikation (Stand 2026-11-10)

Diese Datei hält fest, was in der Entwicklungsumgebung tatsächlich geprüft wurde –
und was nur auf einem echten Proxmox-Host geprüft werden kann.

## Automatisierte Tests

```bash
python3 -m pytest -q
# 30 passed
```

Abgedeckt: Tagesgrenzen inkl. Sommer-/Winterzeit und `day_start_hour`,
Timer-Start/Stop/Wechsel (max. ein laufender Timer), CRUD für Zeitblöcke und
Dauern, Überlappungswarnung, Statistik/CSV (inkl. Formel-Injektion), Settings-
Validierung, Kategorien-Archivierung, Auth-Guard, kaputte JSON-Bodies.

## Statische Checks

```bash
bash -n install/timeblocks.sh
shellcheck -S warning install/timeblocks.sh        # keine Warnungen
bash -n /tmp/tb-bootstrap.sh                        # extrahierter Container-Teil
shellcheck -S warning /tmp/tb-bootstrap.sh          # keine Warnungen
node --check app/static/app.js
node --check app/static/sw.js
```

## Laufzeit-Test mit gunicorn (identisch zur systemd-Unit)

```bash
TIMEBLOCKS_DATA_DIR=/tmp/tb-e2e gunicorn --workers 2 --worker-class gthread \
  --threads 4 --bind 127.0.0.1:8102 app:app
```

- `/api/health`, `/`, `/api/state`, `/manifest.webmanifest`, `/sw.js`,
  Icons: HTTP 200.
- Zwei Worker teilen sich SQLite (WAL) und Session-Secret ohne Fehler.

## Browser-E2E (Playwright, Chromium)

26 Prüfungen, alle grün:

- Timer starten, Laufzeit zählt, Wechsel auf zweiten Timer stoppt den ersten
- Stop erzeugt Zeitblock; Resize per Drag ändert Startzeit und speichert (PATCH)
- Undo nach Resize und nach Löschen stellt den Eintrag wieder her
- Dauer-Nachtrag (45 min) über das Sheet, Eintrag in der Liste
- Berichte: Summe, Kategorie-Balken, Tagesliste, CSV-Download mit Inhalt
- Einstellungen: Tagesbeginn speichern, Kategorie anlegen, Chip erscheint sofort
- Reload: Daten und Kategorie bleiben erhalten, keine JS-Fehler

Login-Modus (11 Prüfungen, alle grün): Overlay, falsches Passwort, Passwort mit
Leerzeichen/Anführungszeichen/Backslash, Session über Reload, API ohne Cookie 401,
CSP, `X-Frame-Options: DENY`, Logout.

Layout: kein horizontaler Überlauf bei 320/390/768/1280 px in Tag, Berichte, Einstellungen.
Service Worker: offline lädt die App-Hülle aus dem Cache.

## Nicht geprüft (fehlende Umgebung)

- Echte LXC-Erstellung (`pct create`), Template-Download, Boot-Verhalten und
  Reboot-Test: In dieser Umgebung gibt es keinen Proxmox-Host (`pct`/`pvesh` fehlen).
- Der Einzeiler benötigt ein öffentlich erreichbares GitHub-Repo. Solange das Repo
  nicht gepusht ist, schlägt `git clone` im Container fehl.

Nach dem Push auf dem Proxmox-Host nachholen:

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/ZeitTracking/main/install/timeblocks.sh)" -- --reboot-test
```

Hinweis: Beim Einzeiler müssen Optionen hinter einem `--` stehen, sonst landet die
erste Option in `$0`. Alternativ das Skript herunterladen und direkt starten:

```bash
wget -qO /tmp/timeblocks.sh https://raw.githubusercontent.com/HatchetMan111/ZeitTracking/main/install/timeblocks.sh
bash /tmp/timeblocks.sh --reboot-test
```
