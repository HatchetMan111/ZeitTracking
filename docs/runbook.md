# Timeblocks – Betriebs-Runbook

Kurzreferenz für Installation, Prüfung, Update, Backup und Fehlersuche.
Alle Befehle mit `<CTID>` auf dem Proxmox-Host ausführen.

## 1. Installation prüfen

```bash
pct status <CTID>                                  # running
pct exec <CTID> -- systemctl is-active timeblocks   # active
pct exec <CTID> -- curl -fsS http://127.0.0.1:8080/api/health
pct exec <CTID> -- ss -ltnp | grep 8080
```

Erwartete Health-Antwort: `{"status":"ok",...}` mit HTTP 200.
Von einem Client im LAN: `curl -I http://<container-ip>:8080/` → `200 OK`.

Wenn der Health-Check nach 30 s nicht grün ist, zeigt der Installer automatisch
`journalctl -u timeblocks -n 40`. Der vollständige Verlauf steht im Installationslog
auf dem Host: `/tmp/timeblocks-install-<datum>.log`.

## 2. Reboot-Test

Automatisch während der Installation:

```bash
bash install/timeblocks.sh --reboot-test
```

Manuell:

```bash
pct reboot <CTID>
sleep 30
pct exec <CTID> -- systemctl is-active timeblocks
pct exec <CTID> -- curl -fsS http://127.0.0.1:8080/api/health
```

Der Dienst ist `enabled`; nach dem Boot muss er ohne Eingriff wieder laufen.
Zusätzlich prüfen, dass die Daten erhalten sind (Einträge von vor dem Reboot sichtbar).

## 3. Update

```bash
pct exec <CTID> -- timeblocks-update
```

Das Skript führt `git fetch --depth 1 origin main`, `git reset --hard FETCH_HEAD`,
`pip install -r requirements.txt` (nur bei venv-Installationen), `systemctl restart timeblocks`
und einen Health-Check aus. Bei Fehlern bleibt der Dienst im letzten funktionierenden Zustand,
das Log zeigt den fehlgeschlagenen Schritt.

Das Frontend wird als committeter React-Build aus `app/static` ausgeliefert. Im Container
werden dafür **kein Node und kein npm** benötigt; ein `npm run build` ist nur für
Entwicklungs-Checkouts nötig.

## 3a. Container umbenennen

Der Default-Hostname ist `zeiterfassung`. Ein erneuter Lauf mit derselben Container-ID
benennt eine bestehende `timeblocks`-CT automatisch um:

```bash
bash install/timeblocks.sh --ctid 109
```

Das Skript erkennt den vorhandenen CT mit Hostname `timeblocks`, setzt den Hostnamen auf
`zeiterfassung` (der CT wird bei Bedarf kurz gestoppt) und führt danach den normalen
Update-Modus aus. Die Datenbank bleibt unverändert.

Ein eigenes `--hostname NAME` ist geschützt: Ohne dieses Flag bricht das Skript bei einem
abweichenden, selbst gesetzten Hostnamen mit einem Hinweis ab, statt ihn zu überschreiben.
Um den Custom-Namen beizubehalten, denselben Namen erneut übergeben:

```bash
bash install/timeblocks.sh --ctid 109 --hostname mein-name
```

## 4. Backup und Restore

Backup (konsistent trotz WAL):

```bash
pct exec <CTID> -- sh -c 'sqlite3 /var/lib/timeblocks/timeblocks.db ".backup /tmp/tb-backup.db"'
pct pull <CTID> /tmp/tb-backup.db ./timeblocks-$(date +%F).db
pct exec <CTID> -- rm -f /tmp/tb-backup.db
```

Restore:

```bash
pct exec <CTID> -- systemctl stop timeblocks
pct push <CTID> ./timeblocks-2026-01-01.db /var/lib/timeblocks/timeblocks.db
pct exec <CTID> -- sh -c 'rm -f /var/lib/timeblocks/timeblocks.db-wal /var/lib/timeblocks/timeblocks.db-shm'
pct exec <CTID> -- sh -c 'chown timeblocks:timeblocks /var/lib/timeblocks/timeblocks.db'
pct exec <CTID> -- systemctl start timeblocks
pct exec <CTID> -- curl -fsS http://127.0.0.1:8080/api/health
```

## 5. Passwort ändern oder entfernen

```bash
pct exec <CTID> -- sh -c 'printf %s\\\\n "TIMEBLOCKS_PASSWORD=\"neues-passwort\"" > /etc/timeblocks.env'
pct exec <CTID> -- chmod 600 /etc/timeblocks.env
pct exec <CTID> -- systemctl restart timeblocks
```

Entfernen (Login deaktiviert): `rm /etc/timeblocks.env` und Dienst neu starten.
Das Passwort wird nur beim Login geprüft; bestehende Sitzungen laufen bis zum Ablauf weiter.

## 6. Port ändern

```bash
pct exec <CTID> -- sed -i 's/:8080/:8090/' /etc/systemd/system/timeblocks.service
pct exec <CTID> -- systemctl daemon-reload
pct exec <CTID> -- systemctl restart timeblocks
```

Firewall im Container (falls ufw aktiv): `ufw allow 8090/tcp`.

## 7. Fehlersuche

| Symptom | Prüfung |
| --- | --- |
| Seite lädt nicht | `ss -ltnp \| grep 8080`, `systemctl status timeblocks`, Container-IP (`hostname -I`) |
| 502/leere Seite | `journalctl -u timeblocks -n 50`; oft fehlende Abhängigkeit nach Update |
| Login-Schleife | `/etc/timeblocks.env` vorhanden und korrekt gequotet? Danach `systemctl restart` |
| Falsche Tagesgrenze | Einstellungen → „Tag beginnt um“; Zeitzone muss zur Region passen |
| Daten weg | `ls -l /var/lib/timeblocks`; Backup zurückspielen (Abschnitt 4) |
| Port belegt | `ss -ltnp`; Port in Unit und ggf. Firewall anpassen |

Nützlich:

```bash
pct exec <CTID> -- journalctl -u timeblocks --since "1 hour ago"
pct exec <CTID> -- systemctl cat timeblocks
pct exec <CTID> -- ls -l /opt/timeblocks /var/lib/timeblocks
```

## 8. Deinstallation

```bash
bash install/timeblocks.sh --uninstall --ctid <CTID>
```

Stoppt und zerstört den Container inklusive Datenbank. Vorher Backup ziehen.

## 9. Checkliste nach jeder Installation

- [ ] `systemctl is-active timeblocks` → `active`
- [ ] `curl -fsS http://127.0.0.1:8080/api/health` → 200
- [ ] Web-UI von einem Client erreichbar
- [ ] Timer starten/stoppen, Eintrag erscheint in der Timeline
- [ ] Eintrag anlegen, verschieben, löschen (Undo)
- [ ] CSV-Export enthält die Einträge
- [ ] Reboot: Dienst und Daten unverändert
- [ ] Backup-Probe durchgeführt
