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
npm run test        # 91 passed (16 Dateien)
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
TIMEBLOCKS_DATA_DIR=/tmp/tb-e2e gunicorn --chdir app --workers 2 --worker-class gthread \
  --threads 4 --bind 127.0.0.1:8102 app:app
```

- `/api/health`, `/`, `/api/state`, `/api/summary`, `/manifest.webmanifest`,
  `/sw.js`, Icons: HTTP 200.
- Zwei Worker teilen sich SQLite (WAL) und Session-Secret ohne Fehler.

## Browser-E2E (Playwright, Chromium)

Einmalig Chromium installieren:

```bash
pip install -r requirements-dev.txt
python3 -m playwright install chromium
```

25 Prüfungen, alle grün. Lauf gegen eine frische Instanz mit temporärem Datenverzeichnis
und Bereitschaftsprüfung über `/api/health`:

```bash
tmpdir="$(mktemp -d)"
trap 'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; rm -rf "$tmpdir"' EXIT
TIMEBLOCKS_DATA_DIR="$tmpdir" PORT=8100 python3 app/app.py >/tmp/timeblocks-e2e.log 2>&1 &
server=$!
for _ in $(seq 1 100); do
  curl -fsS http://127.0.0.1:8100/api/health >/dev/null 2>&1 && break
  sleep 0.1
done
python3 tests/e2e_ui.py
# E2E OK (25 Checks)
```

Geprüft:

- Tag: Tagessumme sichtbar; Timer-Chip startet, läuft ~1,2 s, stoppt und erzeugt
  genau einen zusätzlichen Eintrag (unabhängig von vorhandenen Einträgen).
- Dauer-Nachtrag über das Sheet speichert und erzeugt einen weiteren Eintrag.
- Dashboard: Donut, Gesamt-KPI; Monatswechsel wartet auf die `/api/stats`-Antwort,
  danach Trend, Heatmap und Tages-Tabelle.
- Einstellungen: eindeutiges Detail-Label setzen, PATCH-Antwort abwarten, Seite
  neu laden und den Wert über dieselbe `data-testid` erneut prüfen.
- Offline-Hülle: nach Online-Reload kontrolliert der Service Worker die Seite;
  offline neu geladen bleiben App-Shell und Navigation sichtbar.
- Kein horizontaler Überlauf bei 320/390/768/1280 px in Tag, Dashboard und
  Einstellungen (Navigation über Sidebar bzw. Bottom-Nav je nach Breite).
- Keine JavaScript-Fehler (`pageerror`).

Screenshot der Tagesansicht neu erzeugen:

```bash
python3 tests/screenshot_ui.py   # schreibt docs/screenshot.png
```

Der Lauf setzt `day_start_hour=8`, seedet vier Einträge und nimmt die Tagesansicht
bei 1280×900 ohne leeres 00–08-Band auf.

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
