# Verifikation (Stand 2026-11-11)

Diese Datei hält fest, was in der Entwicklungsumgebung tatsächlich geprüft wurde –
und was nur auf einem echten Proxmox-Host geprüft werden kann.

## Automatisierte Tests

```bash
python3 -m pytest -q
# 49 passed
```

Abgedeckt: Tagesgrenzen inkl. Sommer-/Winterzeit und `day_start_hour`,
Timer-Start/Stop/Wechsel (max. ein laufender Timer), CRUD für Zeitblöcke und
Dauern, Detailfeld und Kategorie-Platzhalter, Migrationen, Überlappungswarnung,
Summary/Statistik/CSV (inkl. Formel-Injektion), Settings-Validierung,
Kategorien-Archivierung, Auth-Guard, kaputte JSON-Bodies sowie Static/PWA-Smoke-Tests
(Index ohne Cache, gehashte Assets immutable, Manifest/Icons, Service Worker,
JSON-404 für Static- und API-Misses).

## Frontend-Tests und Build

```bash
cd web
npm ci
npm run test        # 88 passed (15 Dateien)
npm run typecheck
npm run build       # schreibt app/static
```

`npm run build` enthält `tsc --noEmit` und erzeugt den committeten React-Build in
`app/static`. Im LXC wird kein Node/npm benötigt.

## Statische Checks

```bash
bash -n install/timeblocks.sh
shellcheck -S warning install/timeblocks.sh        # keine Warnungen
```

## Laufzeit-Test mit gunicorn (identisch zur systemd-Unit)

```bash
TIMEBLOCKS_DATA_DIR=/tmp/tb-e2e gunicorn --workers 2 --worker-class gthread \
  --threads 4 --bind 127.0.0.1:8102 app:app
```

- `/api/health`, `/`, `/api/state`, `/api/summary`, `/manifest.webmanifest`,
  `/sw.js`, Icons: HTTP 200.
- Zwei Worker teilen sich SQLite (WAL) und Session-Secret ohne Fehler.

## Browser-E2E (Playwright, Chromium)

22 Prüfungen, alle grün. Lauf gegen eine frische Instanz mit temporärem Datenverzeichnis:

```bash
tmpdir="$(mktemp -d)"
trap 'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; rm -rf "$tmpdir"' EXIT
TIMEBLOCKS_DATA_DIR="$tmpdir" PORT=8100 python3 app/app.py >/tmp/timeblocks-e2e.log 2>&1 &
server=$!
python3 tests/e2e_ui.py
# E2E OK (22 Checks)
```

Geprüft:

- Tag: Tagessumme sichtbar; Timer-Chip startet, läuft ~1,2 s, stoppt und erzeugt Eintrag.
- Dauer-Nachtrag über das Sheet speichert und erzeugt einen zweiten Eintrag.
- Dashboard: Donut, Gesamt-KPI, Monatszeitraum, Trend, Heatmap und Tages-Tabelle.
- Einstellungen: eindeutiges Detail-Label setzen, per Tab blurren, PATCH-Antwort
  abwarten und gespeicherten Wert prüfen.
- Kein horizontaler Überlauf bei 320/390/768/1280 px in Tag, Dashboard und
  Einstellungen (Navigation über Sidebar bzw. Bottom-Nav je nach Breite).
- Keine JavaScript-Fehler (`pageerror`).

Der E2E-Lauf hat drei mobile Layout-Probleme aufgedeckt und behoben:
`min-width: 0` für `.content`, einspaltiges `.dashboard-grid` unter 760 px und
`min-width: 0` für das Eingabefeld der neuen Kategorie.

## Nicht geprüft (fehlende Umgebung)

- Echte LXC-Erstellung (`pct create`), Template-Download, Boot-Verhalten und
  Reboot-Test: In dieser Umgebung gibt es keinen Proxmox-Host (`pct`/`pvesh` fehlen).
- Reales Umbenennen einer bestehenden CT (`--ctid 109`, `timeblocks` →
  `zeiterfassung`): Die Logik ist per Code-Review und ShellCheck abgesichert, muss
  aber auf einem echten Proxmox-Host verifiziert werden.
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
