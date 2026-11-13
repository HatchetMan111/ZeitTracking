#!/usr/bin/env bash
#
# Timeblocks – Proxmox VE Installer (Community-Scripts-Stil, selbstständig)
#
# App:   Timeblocks – lokale Zeiterfassung (Timer, Tages-Timeline, Berichte, CSV)
# Stack: Python 3 + Flask + SQLite + Gunicorn, Web-UI auf Port 8080
# Läuft: vollständig lokal im LXC (kein Docker, keine Cloud)
# Host:  DIESES SKRIPT LÄUFT AUF DEM PROXMOX-HOST (nicht im Container!)
#
# Usage:
#   bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/ZeitTracking/main/install/timeblocks.sh)"
#   APP_PORT=8080 CT_ID=210 bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/ZeitTracking/main/install/timeblocks.sh)"
#   bash timeblocks.sh --ctid 210 --ip 192.168.1.50/24 --gw 192.168.1.1 --password 'MeinPasswort'
#   bash timeblocks.sh --reboot-test
#   bash timeblocks.sh --uninstall --ctid 210
#
set -Eeuo pipefail
umask 077

# ---------------------------------------------------------------------------
# Variablen (alles hier anpassbar)
# ---------------------------------------------------------------------------
APP="timeblocks"
APP_NAME="Timeblocks"
APP_PORT="${APP_PORT:-8080}"
INSTALLER_REPO="${INSTALLER_REPO:-https://github.com/HatchetMan111/ZeitTracking}"
BRANCH="${BRANCH:-main}"
APP_DIR="/opt/timeblocks"
DATA_DIR="/var/lib/timeblocks"
APP_USER="timeblocks"

DEFAULT_CORES="2"
DEFAULT_RAM="1024"
DEFAULT_SWAP="512"
DEFAULT_DISK="8"
DEFAULT_BRIDGE="vmbr0"
DEFAULT_TEMPLATE_STORE="local"
DEFAULT_OS_PRIMARY="debian-13-standard"
DEFAULT_OS_FALLBACK="debian-12-standard"
UNPRIVILEGED="1"

CT_ID="${CT_ID:-${CTID:-}}"
CORES="${CORES:-$DEFAULT_CORES}"
RAM="${RAM:-$DEFAULT_RAM}"
DISK="${DISK:-$DEFAULT_DISK}"
SWAP="$DEFAULT_SWAP"
HOSTNAME_EXPLICIT="0"
HOSTNAME_ARG="${HOSTNAME_ARG:-zeiterfassung}"
STORAGE_ARG=""
TEMPLATE_STORE="${TEMPLATE_STORE:-}"
BRIDGE="${BRIDGE:-$DEFAULT_BRIDGE}"
ROOT_PASSWORD=""
PASSWORD_ARG=""
SSH_KEY_ARG=""
IP_ARG=""
GW_ARG=""
DEBUG="${DEBUG:-0}"
REBOOT_TEST="0"
UNINSTALL="0"
ASSUME_YES="0"

TIMESTAMP="$(date +%F-%H%M%S)"
LOG_FILE="/tmp/${APP}-install-${TIMESTAMP}.log"
BOOTSTRAP_FILE="/tmp/${APP}-bootstrap-${TIMESTAMP}.sh"

# ---------------------------------------------------------------------------
# Logging / Farben
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m' C_RED=$'\e[31m' C_GREEN=$'\e[32m' \
  C_YELLOW=$'\e[33m' C_BLUE=$'\e[34m'
else
  C_RESET="" C_RED="" C_GREEN="" C_YELLOW="" C_BLUE=""
fi

msg_info()  { echo -e "${C_BLUE}[INFO]${C_RESET}  $*"; }
msg_ok()    { echo -e "${C_GREEN}[OK]${C_RESET}    $*"; }
msg_warn()  { echo -e "${C_YELLOW}[WARN]${C_RESET}  $*"; }
msg_error() { echo -e "${C_RED}[ERROR]${C_RESET} $*" >&2; }

exec > >(tee -i "$LOG_FILE") 2>&1
msg_info "Logdatei: $LOG_FILE"
if [[ "$DEBUG" == "1" ]]; then
  echo "--- DEBUG: set -x aktiv ---"
  set -x
fi

catch_error() {
  local ec="$1" line="$2" cmd="$3" i=0
  echo ""
  msg_error "════ Installation fehlgeschlagen (Exit ${ec}) ════"
  msg_error "Befehl     : ${cmd}"
  msg_error "Zeile      : ${line}"
  msg_error "Aufrufkette:"
  while [[ $i -lt ${#FUNCNAME[@]} ]]; do
    local fn="${FUNCNAME[$i]:-main}"
    local ln="${BASH_LINENO[$((i > 0 ? i - 1 : 0))]:-?}"
    echo "  #${i} ${fn} (Zeile ${ln})" >&2
    i=$((i + 1))
  done
  msg_error "Letzte 40 Log-Zeilen:"
  tail -n 40 "$LOG_FILE" >&2 || true
  msg_error "Vollständiges Log: $LOG_FILE"
  msg_error "Für den kompletten Trace erneut mit --debug starten."
  exit "$ec"
}
trap 'catch_error $? "$LINENO" "$BASH_COMMAND"' ERR

usage() {
  cat <<EOF
${APP_NAME} – Proxmox LXC Installer

Usage:
  bash timeblocks.sh [OPTIONEN]

Optionen:
  --ctid ID            Container-ID (Default: nächste freie ID)
  --hostname NAME      Hostname (Default: ${HOSTNAME_ARG})
  --cores N            vCPU (Default: ${DEFAULT_CORES})
  --memory MB          RAM in MB (Default: ${DEFAULT_RAM})
  --disk GB            Disk in GB (Default: ${DEFAULT_DISK})
  --storage NAME       RootFS-Storage (Default: auto, bevorzugt local-lvm)
  --template-store N   Template-Storage (Default: auto, bevorzugt local)
  --bridge NAME        Netzwerk-Bridge (Default: ${DEFAULT_BRIDGE})
  --ip CIDR            Statische IP inkl. Präfix, z. B. 192.168.1.50/24 (Default: DHCP)
  --gw IP              Gateway für statische IP
  --port PORT          Web-UI-Port (Default: ${APP_PORT})
  --password PW        Passwort-Login der Web-UI aktivieren (Default: kein Login, nur LAN)
  --ssh-key PATH       SSH-Public-Key in den Container übernehmen
  --reboot-test        Nach der Installation Reboot + Re-Verifikation ausführen
  --uninstall          Container stoppen und zerstören (braucht --ctid)
  --yes                Rückfragen automatisch bestätigen
  --debug              bash -x + vollständige Fehlerkette
  -h, --help           Diese Hilfe

Beispiele:
  bash timeblocks.sh
  bash timeblocks.sh --ctid 210 --cores 2 --memory 1024 --disk 8
  bash timeblocks.sh --ip 192.168.1.50/24 --gw 192.168.1.1 --password 'geheim'
EOF
}

# ---------------------------------------------------------------------------
# Argumente
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid|--id) CT_ID="$2"; shift 2;;
    --hostname) HOSTNAME_ARG="$2"; HOSTNAME_EXPLICIT="1"; shift 2;;
    --cores) CORES="$2"; shift 2;;
    --memory|--ram) RAM="$2"; shift 2;;
    --disk) DISK="$2"; shift 2;;
    --storage) STORAGE_ARG="$2"; shift 2;;
    --template-store) TEMPLATE_STORE="$2"; shift 2;;
    --bridge) BRIDGE="$2"; shift 2;;
    --ip) IP_ARG="$2"; shift 2;;
    --gw) GW_ARG="$2"; shift 2;;
    --port) APP_PORT="$2"; shift 2;;
    --password) PASSWORD_ARG="$2"; shift 2;;
    --ssh-key) SSH_KEY_ARG="$2"; shift 2;;
    --reboot-test) REBOOT_TEST="1"; shift;;
    --uninstall) UNINSTALL="1"; shift;;
    --yes|-y) ASSUME_YES="1"; shift;;
    --debug) DEBUG="1"; set -x; shift;;
    -h|--help) usage; exit 0;;
    *) msg_error "Unbekannte Option: $1"; usage; exit 1;;
  esac
done

if [[ ! "$APP_PORT" =~ ^[0-9]+$ ]] || (( APP_PORT < 1 || APP_PORT > 65535 )); then
  msg_error "Ungültiger Port: $APP_PORT"
  exit 1
fi
if [[ -n "$IP_ARG" && -z "$GW_ARG" ]]; then
  msg_error "--ip benötigt auch --gw (Gateway)."
  exit 1
fi

# ---------------------------------------------------------------------------
# Host-Prüfung
# ---------------------------------------------------------------------------
[[ "$(id -u)" == "0" ]] || { msg_error "Bitte als root auf dem Proxmox-Host ausführen."; exit 1; }
for bin in pct pvesh pveam pvesm; do
  command -v "$bin" >/dev/null \
    || { msg_error "'$bin' nicht gefunden – das ist kein Proxmox-VE-Host."; exit 1; }
done

# ---------------------------------------------------------------------------
# Deinstallation
# ---------------------------------------------------------------------------
if [[ "$UNINSTALL" == "1" ]]; then
  [[ -n "$CT_ID" ]] || { msg_error "--uninstall benötigt --ctid."; exit 1; }
  if ! pct status "$CT_ID" >/dev/null 2>&1; then
    msg_warn "CT $CT_ID existiert nicht – nichts zu tun."
    exit 0
  fi
  if [[ "$ASSUME_YES" != "1" ]]; then
    read -r -p "CT ${CT_ID} (${APP_NAME}) wirklich stoppen und zerstören? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || { msg_info "Abgebrochen."; exit 0; }
  fi
  pct stop "$CT_ID" 2>/dev/null || true
  pct destroy "$CT_ID"
  msg_ok "CT $CT_ID wurde zerstört."
  exit 0
fi

# Nächste freie ID, falls keine angegeben
if [[ -z "$CT_ID" ]]; then
  CT_ID="$(pvesh get /cluster/nextid)"
  msg_info "Nächste freie CT-ID: $CT_ID"
fi
[[ "$CT_ID" =~ ^[0-9]+$ ]] || { msg_error "CT-ID muss numerisch sein: $CT_ID"; exit 1; }

# ---------------------------------------------------------------------------
# Storage / Template
# ---------------------------------------------------------------------------
if [[ -z "$STORAGE_ARG" ]]; then
  if pvesm status --storage local-lvm >/dev/null 2>&1; then
    STORAGE_ARG="local-lvm"
  else
    STORAGE_ARG="$(pvesm status -content rootdir | awk 'NR > 1 {print $1; exit}')"
  fi
fi
[[ -n "$STORAGE_ARG" ]] || { msg_error "Kein RootFS-Storage gefunden."; exit 1; }

if [[ -z "$TEMPLATE_STORE" ]]; then
  TEMPLATE_STORE="$(pvesm status -content vztmpl 2>/dev/null | awk 'NR > 1 {print $1; exit}')"
  TEMPLATE_STORE="${TEMPLATE_STORE:-$DEFAULT_TEMPLATE_STORE}"
fi

msg_info "CT ${CT_ID} | ${CORES} vCPU / ${RAM} MB / ${DISK} GB | Storage: ${STORAGE_ARG} | Bridge: ${BRIDGE}"

msg_info "Prüfe LXC-Template ..."
pveam update >/dev/null 2>&1 || msg_warn "pveam update scheiterte – nutze vorhandene Templates."
AVAILABLE_TEMPLATES="$(pveam available --section system 2>/dev/null || true)"

TEMPLATE="$(printf '%s' "$AVAILABLE_TEMPLATES" \
  | grep -oP "${DEFAULT_OS_PRIMARY}[^ ]*amd64[^ ]*\.tar\.(gz|xz|zst)" \
  | sort -V | tail -n1 || true)"
if [[ -z "${TEMPLATE:-}" ]]; then
  msg_warn "Kein ${DEFAULT_OS_PRIMARY}-Template verfügbar – versuche ${DEFAULT_OS_FALLBACK}."
  TEMPLATE="$(printf '%s' "$AVAILABLE_TEMPLATES" \
    | grep -oP "${DEFAULT_OS_FALLBACK}[^ ]*amd64[^ ]*\.tar\.(gz|xz|zst)" \
    | sort -V | tail -n1 || true)"
fi
if [[ -z "${TEMPLATE:-}" ]]; then
  msg_warn "Kein Standard-Debian-Template gefunden – suche beliebiges Debian-Template."
  TEMPLATE="$(printf '%s' "$AVAILABLE_TEMPLATES" \
    | grep -oP "debian-[0-9]+-standard[^ ]*amd64[^ ]*\.tar\.(gz|xz|zst)" \
    | sort -V | tail -n1 || true)"
fi
if [[ -z "${TEMPLATE:-}" ]]; then
  msg_error "Kein Debian-Template gefunden. Verfügbare System-Templates (Auszug):"
  printf '%s\n' "$AVAILABLE_TEMPLATES" | head -n 20 >&2 || true
  exit 1
fi
if ! pveam list "$TEMPLATE_STORE" 2>/dev/null | grep -q "$TEMPLATE"; then
  msg_info "Lade Template ${TEMPLATE} ..."
  pveam download "$TEMPLATE_STORE" "$TEMPLATE"
fi
msg_ok "Template bereit: ${TEMPLATE_STORE}:vztmpl/${TEMPLATE}"

# ---------------------------------------------------------------------------
# Container erstellen (idempotent)
# ---------------------------------------------------------------------------
if pct status "$CT_ID" >/dev/null 2>&1; then
  EXISTING_HOSTNAME="$(pct config "$CT_ID" | awk -F': ' '/^hostname:/ {print $2}')"
  if [[ "$EXISTING_HOSTNAME" != "$HOSTNAME_ARG" ]]; then
    if [[ "$EXISTING_HOSTNAME" == "timeblocks" && "$HOSTNAME_EXPLICIT" == "0" ]]; then
      msg_info "Benenne CT ${CT_ID} von 'timeblocks' in '${HOSTNAME_ARG}' um ..."
      if ! pct set "$CT_ID" --hostname "$HOSTNAME_ARG" 2>/dev/null; then
        msg_warn "Hostname-Änderung im Betrieb abgelehnt – CT wird kurz gestoppt."
        if ! pct stop "$CT_ID"; then
          pct start "$CT_ID" >/dev/null 2>&1 || true
          msg_error "CT ${CT_ID} konnte nicht gestoppt werden – Hostname bleibt unverändert."
          exit 1
        fi
        if pct set "$CT_ID" --hostname "$HOSTNAME_ARG"; then
          if ! pct start "$CT_ID"; then
            msg_error "Hostname geändert, aber CT ${CT_ID} konnte nicht gestartet werden – bitte manuell starten."
            exit 1
          fi
        else
          if ! pct start "$CT_ID"; then
            msg_error "Hostname-Änderung fehlgeschlagen und CT ${CT_ID} konnte nicht gestartet werden – bitte manuell prüfen."
            exit 1
          fi
          msg_error "Hostname konnte auch im gestoppten Zustand nicht geändert werden – CT läuft wieder mit '${EXISTING_HOSTNAME}'."
          exit 1
        fi
      fi
      msg_ok "Hostname in PVE-Config: ${HOSTNAME_ARG}"
    else
      msg_error "CT ${CT_ID} existiert bereits mit Hostname '${EXISTING_HOSTNAME}'."
      msg_error "Zum Aktualisieren denselben Hostnamen verwenden oder '--hostname ${EXISTING_HOSTNAME}' setzen."
      exit 1
    fi
  fi
  msg_warn "CT ${CT_ID} existiert – Update-Modus (Code wird aktualisiert)."
else
  ROOT_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)"
  if [[ -n "$IP_ARG" ]]; then
    NET0="name=eth0,bridge=${BRIDGE},ip=${IP_ARG},gw=${GW_ARG}"
  else
    NET0="name=eth0,bridge=${BRIDGE},ip=dhcp"
  fi
  msg_info "Erstelle CT ${CT_ID} (${HOSTNAME_ARG}) ..."
  pct create "$CT_ID" "${TEMPLATE_STORE}:vztmpl/${TEMPLATE}" \
    --hostname "$HOSTNAME_ARG" \
    --cores "$CORES" --memory "$RAM" --swap "$SWAP" \
    --rootfs "${STORAGE_ARG}:${DISK}" \
    --net0 "$NET0" \
    --unprivileged "$UNPRIVILEGED" --features nesting=1 \
    --onboot 1 --start 0 \
    --tags "timeblocks,zeit" \
    --description "Timeblocks – lokale Zeiterfassung (Timer, Timeline, Berichte). Installiert von ${INSTALLER_REPO}" \
    --password "$ROOT_PASSWORD"
  msg_ok "CT ${CT_ID} erstellt (unprivilegiert, onboot=1)."
fi

HOST_TZ="$(cat /etc/timezone 2>/dev/null || true)"
if [[ -z "$HOST_TZ" ]] && command -v timedatectl >/dev/null 2>&1; then
  HOST_TZ="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
fi

pct start "$CT_ID" 2>/dev/null || true
msg_info "Warte auf Container-Netz ..."
CT_IP=""
for _ in $(seq 1 30); do
  sleep 3
  CT_IP="$(pct exec "$CT_ID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [[ -n "${CT_IP:-}" ]] && break
done
[[ -n "${CT_IP:-}" ]] || { msg_error "Keine Container-IP erhalten – Bridge/DHCP prüfen."; exit 1; }
msg_ok "Container-IP: ${CT_IP}"

if [[ -n "$SSH_KEY_ARG" ]]; then
  [[ -f "$SSH_KEY_ARG" ]] || { msg_error "SSH-Key nicht gefunden: $SSH_KEY_ARG"; exit 1; }
  pct exec "$CT_ID" -- mkdir -p /root/.ssh
  pct push "$CT_ID" "$SSH_KEY_ARG" /root/.ssh/authorized_keys
  pct exec "$CT_ID" -- chmod 600 /root/.ssh/authorized_keys
  msg_ok "SSH-Key installiert."
fi

# ---------------------------------------------------------------------------
# Bootstrap-Skript für den Container (wird per pct push übergeben)
# ---------------------------------------------------------------------------
cat > "$BOOTSTRAP_FILE" <<'BOOTSTRAP'
#!/usr/bin/env bash
#
# Timeblocks Container-Bootstrap. Läuft INNERHALB des Debian-LXC.
# Idempotent: apt + git reset + systemd restart.
#
set -Eeuo pipefail
umask 022
export LANG=C.UTF-8

REPO=""
BRANCH="main"
PORT="8080"
APP_DIR="/opt/timeblocks"
DATA_DIR="/var/lib/timeblocks"
APP_USER="timeblocks"
PASSWORD=""
RAW_BASE=""
HOST_TZ=""
HOSTNAME_TARGET=""
DNS_SERVERS=""
LOG_FILE="/var/log/timeblocks-bootstrap.log"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --branch) BRANCH="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --app-dir) APP_DIR="$2"; shift 2;;
    --data-dir) DATA_DIR="$2"; shift 2;;
    --user) APP_USER="$2"; shift 2;;
    --password-file)
      if [[ -f "$2" ]]; then PASSWORD="$(cat "$2")"; fi
      shift 2;;
    --raw-base) RAW_BASE="$2"; shift 2;;
    --timezone) HOST_TZ="$2"; shift 2;;
    --hostname) HOSTNAME_TARGET="$2"; shift 2;;
    --dns-servers) DNS_SERVERS="$2"; shift 2;;
    *) echo "[ERROR] Unbekanntes Bootstrap-Argument: $1" >&2; exit 1;;
  esac
done

touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

if [[ -n "$HOSTNAME_TARGET" ]]; then
  hostnamectl set-hostname "$HOSTNAME_TARGET" 2>/dev/null \
    || printf '%s\n' "$HOSTNAME_TARGET" > /etc/hostname
  if grep -q '^127\.0\.1\.1[[:space:]]' /etc/hosts; then
    sed -i "s|^127\.0\.1\.1.*|127.0.1.1\t${HOSTNAME_TARGET}|" /etc/hosts
  else
    printf '127.0.1.1\t%s\n' "$HOSTNAME_TARGET" >> /etc/hosts
  fi
fi

C_RESET=$'\e[0m' C_RED=$'\e[31m' C_GREEN=$'\e[32m' C_BLUE=$'\e[34m' C_YELLOW=$'\e[33m'
msg_info()  { echo -e "${C_BLUE}[INFO]${C_RESET}  $*"; }
msg_ok()    { echo -e "${C_GREEN}[OK]${C_RESET}    $*"; }
msg_warn()  { echo -e "${C_YELLOW}[WARN]${C_RESET}  $*"; }
msg_error() { echo -e "${C_RED}[ERROR]${C_RESET} $*" >&2; }

catch_error() {
  local ec="$1" line="$2" cmd="$3" i=0
  echo ""
  msg_error "════ Bootstrap fehlgeschlagen (Exit ${ec}) ════"
  msg_error "Befehl     : ${cmd}"
  msg_error "Zeile      : ${line}"
  msg_error "Aufrufkette:"
  while [[ $i -lt ${#FUNCNAME[@]} ]]; do
    echo "  #${i} ${FUNCNAME[$i]:-main} (Zeile ${BASH_LINENO[$((i > 0 ? i - 1 : 0))]:-?})" >&2
    i=$((i + 1))
  done
  msg_error "Letzte 50 Log-Zeilen:"
  tail -n 50 "$LOG_FILE" >&2 || true
  if command -v journalctl >/dev/null 2>&1; then
    msg_error "Journal (timeblocks, letzte 40 Zeilen):"
    journalctl -u timeblocks --no-pager -n 40 >&2 || true
  fi
  exit "$ec"
}
trap 'catch_error $? "$LINENO" "$BASH_COMMAND"' ERR

export DEBIAN_FRONTEND=noninteractive
msg_info "Warte auf Netzwerk/DNS im Container ..."

# Readiness wie apt selbst: Namensauflösung + HTTP-Fetch (kein HTTPS – vermeidet
# False-Negatives durch TLS-/Zeitprobleme im frischen CT).
net_ready() {
  getent hosts deb.debian.org >/dev/null 2>&1 \
    && curl -fsS -m 5 -o /dev/null http://deb.debian.org/ 2>/dev/null
}

NET_OK="0"
for _ in $(seq 1 30); do
  if net_ready; then NET_OK="1"; break; fi
  sleep 2
done

# DNS-Reparatur: Wenn der CT selbst nicht auflöst (DHCP ohne DNS, blockierter oder
# leerer Stub), die Nameserver des Proxmox-Hosts übernehmen – der Host löst ja
# nachweislich auf, sonst wäre dieses Skript nie heruntergeladen worden. Als letzte
# Rettung zusätzlich das Gateway eintragen. Original bleibt als Backup liegen.
if [[ "$NET_OK" != "1" ]]; then
  cp /etc/resolv.conf /etc/resolv.conf.timeblocks-orig 2>/dev/null || true
  msg_warn "DNS im CT nicht bereit – schreibe Nameserver des Hosts: ${DNS_SERVERS:-<keine>}"
  : > /etc/resolv.conf
  for ns in $DNS_SERVERS; do printf 'nameserver %s\n' "$ns" >> /etc/resolv.conf; done
  GW="$(ip route 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "via") {print $(i + 1); exit}}')"
  if [[ -n "$GW" ]] && ! grep -qs "^nameserver ${GW}$" /etc/resolv.conf; then
    printf 'nameserver %s\n' "$GW" >> /etc/resolv.conf
  fi
  for _ in $(seq 1 15); do
    if net_ready; then NET_OK="1"; break; fi
    sleep 2
  done
  if [[ "$NET_OK" == "1" ]]; then
    msg_ok "DNS funktioniert nach Nameserver-Übernahme (Original: /etc/resolv.conf.timeblocks-orig)."
  fi
fi

if [[ "$NET_OK" != "1" ]]; then
  msg_error "Netzwerk/DNS im Container nicht nutzbar – Abbruch vor apt."
  msg_error "/etc/resolv.conf:"
  sed 's/^/    /' /etc/resolv.conf >&2 || true
  msg_error "IP-Konfiguration:"
  ip -br addr 2>/dev/null | sed 's/^/    /' >&2 || true
  msg_error "Test im CT: getent hosts deb.debian.org && curl -m5 -I http://deb.debian.org"
  exit 1
fi
msg_ok "Netzwerk und DNS im Container bereit."

msg_info "Aktualisiere Paketlisten ..."
for attempt in 1 2 3; do
  apt-get update -qq && break
  [[ "$attempt" == "3" ]] && { msg_error "apt-get update fehlgeschlagen – Netzwerk/DNS prüfen."; exit 1; }
  sleep 5
done

msg_info "Installiere Basispakete ..."
APT_OK="0"
for attempt in 1 2 3; do
  if apt-get install -y -qq --no-install-recommends \
    python3 python3-venv python3-pip git curl ca-certificates sqlite3 tzdata >/dev/null; then
    APT_OK="1"
    break
  fi
  [[ "$attempt" == "3" ]] && { msg_error "apt-get install fehlgeschlagen (3 Versuche) – Log prüfen."; exit 1; }
  msg_warn "apt-get install Versuch ${attempt} fehlgeschlagen – wiederhole mit --fix-missing ..."
  apt-get update -qq >/dev/null 2>&1 || true
  sleep 5
done
msg_ok "Basispakete installiert."

if [[ -n "$HOST_TZ" && -f "/usr/share/zoneinfo/${HOST_TZ}" ]]; then
  ln -sfn "/usr/share/zoneinfo/${HOST_TZ}" /etc/localtime
  printf '%s\n' "$HOST_TZ" > /etc/timezone
  msg_ok "Zeitzone übernommen: ${HOST_TZ}"
else
  msg_warn "Host-Zeitzone nicht übernommen – in den Einstellungen prüfen."
fi

GUNICORN_BIN=""
use_system_packages() {
  apt-get install -y -qq --no-install-recommends python3-flask >/dev/null 2>&1 || return 1
  apt-get install -y -qq --no-install-recommends gunicorn >/dev/null 2>&1 \
    || apt-get install -y -qq --no-install-recommends python3-gunicorn >/dev/null 2>&1 \
    || return 1
  python3 -c "import flask" >/dev/null 2>&1 || return 1
  command -v gunicorn >/dev/null 2>&1 || return 1
}

msg_info "Richte Benutzer und Verzeichnisse ein ..."
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$APP_DIR" "$DATA_DIR"

msg_info "Hole App-Code von ${REPO} (${BRANCH}) ..."
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "$APP_DIR" remote set-url origin "$REPO"
  git -C "$APP_DIR" fetch --quiet --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard --quiet FETCH_HEAD
else
  rm -rf "$APP_DIR"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
test -f "${APP_DIR}/app/app.py" || { msg_error "Checkout unvollständig: ${APP_DIR}/app/app.py fehlt."; exit 1; }
msg_ok "App-Code aktuell."

msg_info "Installiere Python-Abhängigkeiten ..."
if use_system_packages; then
  GUNICORN_BIN="$(command -v gunicorn)"
  msg_ok "Flask + Gunicorn aus Debian-Paketen."
else
  msg_warn "Debian-Pakete unvollständig – nutze venv + pip als Fallback."
  python3 -m venv "${APP_DIR}/.venv"
  "${APP_DIR}/.venv/bin/pip" install --quiet --upgrade pip
  "${APP_DIR}/.venv/bin/pip" install --quiet flask gunicorn
  GUNICORN_BIN="${APP_DIR}/.venv/bin/gunicorn"
  msg_ok "Flask + Gunicorn im venv installiert."
fi
ln -sfn "$GUNICORN_BIN" /usr/local/bin/timeblocks-gunicorn

chown -R "root:root" "$APP_DIR"
chmod -R a+rX "$APP_DIR"
chown -R "${APP_USER}:${APP_USER}" "$DATA_DIR"
chmod 750 "$DATA_DIR"

rm -f /root/timeblocks.pw
if [[ -n "$PASSWORD" ]]; then
  escaped="${PASSWORD//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"
  umask 077
  printf 'TIMEBLOCKS_PASSWORD="%s"\n' "$escaped" > /etc/timeblocks.env
  unset PASSWORD escaped
  msg_ok "Passwort-Login aktiviert (/etc/timeblocks.env, 0600)."
else
  rm -f /etc/timeblocks.env
  msg_warn "Kein Passwort gesetzt – Web-UI ohne Login (nur im LAN betreiben)."
fi

msg_info "Installiere systemd-Unit ..."
UNIT_TMP="$(mktemp)"
if [[ -n "$RAW_BASE" ]] && curl -fsSL -m 20 -o "$UNIT_TMP" "${RAW_BASE}/systemd/timeblocks.service"; then
  msg_ok "Unit aus Repo geladen."
else
  msg_warn "Unit-URL nicht erreichbar – schreibe eingebaute Unit."
  cat > "$UNIT_TMP" <<'UNIT'
[Unit]
Description=Timeblocks - lokale Zeiterfassung
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=timeblocks
Group=timeblocks
WorkingDirectory=/opt/timeblocks/app
Environment=PYTHONUNBUFFERED=1
Environment=TIMEBLOCKS_DATA_DIR=/var/lib/timeblocks
Environment=XDG_RUNTIME_DIR=/run/timeblocks
EnvironmentFile=-/etc/timeblocks.env
ExecStart=/usr/local/bin/timeblocks-gunicorn --workers 2 --worker-class gthread --threads 4 --timeout 60 --graceful-timeout 20 --access-logfile - --error-logfile - --bind 0.0.0.0:8080 app:app
Restart=always
RestartSec=2
RuntimeDirectory=timeblocks
RuntimeDirectoryMode=0750
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/timeblocks

[Install]
WantedBy=multi-user.target
UNIT
fi
sed -i "s|0\.0\.0\.0:8080|0.0.0.0:${PORT}|g" "$UNIT_TMP"
install -m 0644 "$UNIT_TMP" /etc/systemd/system/timeblocks.service
rm -f "$UNIT_TMP"

cat > /usr/local/bin/timeblocks-update <<'UPDATE'
#!/usr/bin/env bash
set -Eeuo pipefail
echo "[INFO] Aktualisiere Timeblocks ..."
cd /opt/timeblocks
git fetch --depth 1 origin main
git reset --hard FETCH_HEAD
if [[ -x .venv/bin/pip && -f requirements.txt ]]; then
  .venv/bin/pip install --quiet -r requirements.txt
fi
systemctl restart timeblocks
sleep 2
systemctl --no-pager --full status timeblocks | head -n 12 || true
if ! curl -fsS -m 5 "http://127.0.0.1:$(awk -F'[: ]+' '/--bind 0.0.0.0:/ {print $3; exit}' /etc/systemd/system/timeblocks.service)/api/health" >/dev/null 2>&1; then
  echo "[WARN] Health-Check nach Update fehlgeschlagen – journalctl -u timeblocks prüfen."
  exit 1
fi
echo "[OK] Update abgeschlossen."
UPDATE
chmod 0755 /usr/local/bin/timeblocks-update

msg_info "Starte Service ..."
systemctl daemon-reload
systemctl enable timeblocks >/dev/null 2>&1
systemctl restart timeblocks

msg_info "Öffne Port ${PORT} in aktiver Firewall (falls vorhanden) ..."
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
  msg_ok "ufw: Port ${PORT}/tcp freigegeben."
else
  msg_info "Keine aktive ufw-Firewall – Port ist offen."
fi

msg_info "Verifiziere Service und Web-UI ..."
systemctl is-active --quiet timeblocks || {
  msg_error "Service ist nicht aktiv."
  systemctl status timeblocks --no-pager >&2 || true
  journalctl -u timeblocks --no-pager -n 60 >&2 || true
  exit 1
}
msg_ok "systemctl is-active timeblocks = active"

WEB_OK="0"
for _ in $(seq 1 30); do
  if curl -fsS -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    WEB_OK="1"
    break
  fi
  sleep 2
done
if [[ "$WEB_OK" != "1" ]]; then
  msg_error "Web-UI antwortet nicht auf http://127.0.0.1:${PORT}/api/health"
  systemctl status timeblocks --no-pager >&2 || true
  journalctl -u timeblocks --no-pager -n 60 >&2 || true
  exit 1
fi
msg_ok "Web-UI antwortet (HTTP 200 auf /api/health)."
echo "BOOTSTRAP_COMPLETE"
BOOTSTRAP

chmod 0755 "$BOOTSTRAP_FILE"

# ---------------------------------------------------------------------------
# Bootstrap in den Container übertragen und ausführen
# ---------------------------------------------------------------------------
REPO_SLUG="$(printf '%s' "$INSTALLER_REPO" | sed -E 's#^https?://github\.com/##; s#/+#/#g; s#\.git$##; s#/$##')"
if [[ "$REPO_SLUG" == */* ]]; then
  RAW_BASE="https://raw.githubusercontent.com/${REPO_SLUG}/${BRANCH}"
else
  RAW_BASE=""
fi

msg_info "Übertrage Bootstrap in CT ${CT_ID} ..."
pct push "$CT_ID" "$BOOTSTRAP_FILE" /root/timeblocks-bootstrap.sh
pct exec "$CT_ID" -- chmod 0700 /root/timeblocks-bootstrap.sh

PW_FILE=""
if [[ -n "$PASSWORD_ARG" ]]; then
  PW_FILE="/tmp/${APP}-pw-${TIMESTAMP}"
  ( umask 077; printf '%s' "$PASSWORD_ARG" > "$PW_FILE" )
  pct push "$CT_ID" "$PW_FILE" /root/timeblocks.pw
  pct exec "$CT_ID" -- chmod 0600 /root/timeblocks.pw
  rm -f "$PW_FILE"
  msg_ok "Web-UI-Passwort übergeben (nicht in der Prozessliste sichtbar)."
fi

msg_info "Installiere ${APP_NAME} im Container (kann einige Minuten dauern) ..."
# Nameserver des Hosts als DNS-Fallback für den CT (über DNS_SERVERS überschreibbar).
# Loopback-Einträge (systemd-resolved-Stub) funktionieren aus dem CT nicht.
if [[ -z "${DNS_SERVERS:-}" ]]; then
  DNS_SERVERS="$(awk '/^nameserver/ {print $2}' /etc/resolv.conf 2>/dev/null \
    | grep -v -e '^127\.' -e '^::1$' | head -3 | tr '\n' ' ' | sed 's/ $//')"
fi
BOOT_ARGS=(
  --hostname "$HOSTNAME_ARG"
  --repo "$INSTALLER_REPO"
  --branch "$BRANCH"
  --port "$APP_PORT"
  --app-dir "$APP_DIR"
  --data-dir "$DATA_DIR"
  --user "$APP_USER"
  --raw-base "$RAW_BASE"
  --timezone "$HOST_TZ"
  --dns-servers "$DNS_SERVERS"
)
if [[ -n "$PASSWORD_ARG" ]]; then
  BOOT_ARGS+=(--password-file /root/timeblocks.pw)
fi
pct exec "$CT_ID" -- bash /root/timeblocks-bootstrap.sh "${BOOT_ARGS[@]}"

# ---------------------------------------------------------------------------
# Host-seitige Verifikation
# ---------------------------------------------------------------------------
msg_info "Host-seitige Verifikation ..."
pct exec "$CT_ID" -- systemctl is-active --quiet timeblocks \
  || { msg_error "Service im Container nicht aktiv."; exit 1; }
pct exec "$CT_ID" -- curl -fsS -m 10 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null \
  || { msg_error "HTTP-Check im Container fehlgeschlagen."; exit 1; }
msg_ok "Service aktiv und Web-UI antwortet."

if [[ "$REBOOT_TEST" == "1" ]]; then
  msg_info "Reboot-Test: starte CT ${CT_ID} neu ..."
  pct reboot "$CT_ID"
  sleep 10
  for _ in $(seq 1 40); do
    sleep 3
    if pct exec "$CT_ID" -- systemctl is-active --quiet timeblocks 2>/dev/null \
      && pct exec "$CT_ID" -- curl -fsS -m 5 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
      msg_ok "Nach Reboot: Service aktiv und Web-UI erreichbar."
      break
    fi
  done
  pct exec "$CT_ID" -- systemctl is-active --quiet timeblocks \
    || { msg_error "Reboot-Test fehlgeschlagen: Service nicht aktiv."; exit 1; }
  pct exec "$CT_ID" -- curl -fsS -m 10 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null \
    || { msg_error "Reboot-Test fehlgeschlagen: HTTP-Check."; exit 1; }
  echo ""
  msg_info "Reboot-Beleg (systemctl status + journal):"
  pct exec "$CT_ID" -- systemctl is-active timeblocks
  pct exec "$CT_ID" -- systemctl show timeblocks -p ActiveState -p SubState -p NRestarts
  pct exec "$CT_ID" -- journalctl -u timeblocks --no-pager -n 8
  CT_IP="$(pct exec "$CT_ID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi

if [[ -n "$PASSWORD_ARG" ]]; then
  LOGIN_TEXT="aktiv (Passwort siehe unten)"
else
  LOGIN_TEXT="deaktiviert (nur LAN)"
fi

echo ""
echo "════════════════ INSTALLATION ERFOLGREICH ════════════════"
echo "  App          : ${APP_NAME} – lokale Zeiterfassung"
echo "  Container    : CT ${CT_ID} (Hostname: ${HOSTNAME_ARG}, unprivilegiert, onboot=1)"
echo "  Ressourcen   : ${CORES} vCPU / ${RAM} MB RAM / ${DISK} GB Disk"
echo "  Web UI       : http://${CT_IP}:${APP_PORT}"
echo "  Health       : http://${CT_IP}:${APP_PORT}/api/health"
echo "  Login        : ${LOGIN_TEXT}"
echo "  Web-Passwort : ${PASSWORD_ARG:-<kein Login>}"
echo "  Root-Passwort: ${ROOT_PASSWORD:-<bestehender CT, unverändert>} (nur jetzt angezeigt!)"
echo "  Service      : pct exec ${CT_ID} -- systemctl status timeblocks"
echo "  Update       : Skript erneut ausführen (idempotent) oder im CT: timeblocks-update"
echo "  Reboot-Test  : pct reboot ${CT_ID} && sleep 30 && curl -fs http://${CT_IP}:${APP_PORT}/api/health"
echo "  Deinstall    : bash timeblocks.sh --uninstall --ctid ${CT_ID}"
echo "  Log          : ${LOG_FILE}"
echo "══════════════════════════════════════════════════════════"
