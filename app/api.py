"""JSON API for Timeblocks."""
from __future__ import annotations

import csv
import io
import os
import secrets
from datetime import date, timedelta

from flask import Blueprint, Response, jsonify, request, session

import db
import timeutil

bp = Blueprint("api", __name__)

PASSWORD = os.environ.get("TIMEBLOCKS_PASSWORD", "")
VERSION = "2.0.0"
MIN_ENTRY_MS = 1000
MAX_DURATION_MINUTES = 1440


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@bp.errorhandler(ApiError)
def _handle_api_error(exc: ApiError):
    return jsonify({"error": exc.message}), exc.status


@bp.before_request
def _guard():
    if not PASSWORD:
        return None
    open_endpoints = {"api.health", "api.auth_status", "api.login", "api.logout"}
    if request.endpoint in open_endpoints:
        return None
    if session.get("auth") is True:
        return None
    return jsonify({"error": "Nicht angemeldet"}), 401


def _state(conn):
    return conn.execute("SELECT * FROM app_state WHERE id = 1").fetchone()


def _tz(conn) -> str:
    return _state(conn)["timezone"]


def _day_start_hour(conn) -> int:
    return int(_state(conn)["day_start_hour"])


def _category(conn, category_id: int):
    row = conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
    if row is None:
        raise ApiError("Kategorie nicht gefunden", 404)
    return row


def _entry(conn, entry_id: int):
    row = conn.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
    if row is None:
        raise ApiError("Eintrag nicht gefunden", 404)
    return row


def _open_timer(conn):
    return conn.execute(
        "SELECT * FROM entries WHERE kind = 'timeline' AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
    ).fetchone()


def _entry_json(row, now: int):
    ended = row["ended_at"]
    if row["kind"] == "timeline" and ended is None:
        ended = now
    return {
        "id": row["id"],
        "category_id": row["category_id"],
        "kind": row["kind"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "effective_end": ended,
        "minutes": row["minutes"],
        "note": row["note"],
        "updated_at": row["updated_at"],
    }


def _csv_safe(value: str) -> str:
    """Verhindert Formel-Injektion in Tabellenkalkulationen."""
    if value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _overlap_ms(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def _effective_end(row, now: int) -> int:
    if row["kind"] == "timeline":
        return row["ended_at"] if row["ended_at"] is not None else now
    return row["started_at"] + int(row["minutes"] or 0) * 60000


def _json_body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Erwartet wird ein JSON-Objekt")
    return data


def _date_arg(name: str, default: str) -> str:
    value = request.args.get(name) or default
    try:
        timeutil.parse_date(value)
    except ValueError as exc:
        raise ApiError(str(exc)) from exc
    return value


def _validate_minutes(value) -> int:
    try:
        minutes = int(value)
    except (TypeError, ValueError) as exc:
        raise ApiError("Minuten müssen eine ganze Zahl sein") from exc
    if minutes < 1 or minutes > MAX_DURATION_MINUTES:
        raise ApiError(f"Minuten müssen zwischen 1 und {MAX_DURATION_MINUTES} liegen")
    return minutes


def _categories_json(conn, include_archived: bool = False):
    sql = "SELECT * FROM categories"
    if not include_archived:
        sql += " WHERE archived = 0"
    sql += " ORDER BY sort_order, name"
    return [dict(row) for row in conn.execute(sql).fetchall()]


def _days_with_data(conn, end_ms: int, tz: str, day_start_hour: int, window_days: int = 90):
    anchor = timeutil.local_date_str(end_ms - 1, tz)
    anchor_date = timeutil.parse_date(anchor)
    window_start = timeutil.day_bounds(
        (anchor_date - timedelta(days=window_days - 1)).isoformat(), day_start_hour, tz
    )[0]
    rows = conn.execute(
        "SELECT kind, started_at, ended_at, minutes FROM entries"
        " WHERE started_at < ? AND (kind = 'duration' OR ended_at IS NULL OR ended_at > ?)",
        (end_ms, window_start),
    ).fetchall()
    stamps: set[str] = set()
    for row in rows:
        start = max(window_start, row["started_at"])
        if row["kind"] == "duration":
            stamps.add(timeutil.local_date_str(row["started_at"], tz))
            continue
        end = min(end_ms, row["ended_at"] if row["ended_at"] is not None else end_ms)
        if end <= start:
            end = start + 60000
        cursor = timeutil.to_local(start, tz).date()
        last = timeutil.to_local(end - 1, tz).date()
        while cursor <= last:
            stamps.add(cursor.isoformat())
            cursor += timedelta(days=1)
    return sorted(stamps)


@bp.get("/health")
def health():
    return jsonify({"status": "ok", "app": "timeblocks", "version": VERSION, "now": timeutil.now_ms()})


@bp.get("/auth/status")
def auth_status():
    return jsonify({"required": bool(PASSWORD), "authenticated": bool(session.get("auth")) or not PASSWORD})


@bp.post("/login")
def login():
    if not PASSWORD:
        return jsonify({"ok": True, "required": False})
    data = _json_body()
    if secrets.compare_digest(str(data.get("password", "")), PASSWORD):
        session["auth"] = True
        session.permanent = True
        return jsonify({"ok": True})
    raise ApiError("Falsches Passwort", 401)


@bp.post("/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@bp.get("/state")
def get_state():
    conn = db.connect()
    try:
        state = _state(conn)
        now = timeutil.now_ms()
        running = _open_timer(conn)
        return jsonify(
            {
                "now": now,
                "day_start_hour": state["day_start_hour"],
                "timezone": state["timezone"],
                "running_entry": _entry_json(running, now) if running else None,
                "categories": _categories_json(conn),
                "auth_required": bool(PASSWORD),
                "version": VERSION,
            }
        )
    finally:
        conn.close()


@bp.get("/day")
def get_day():
    conn = db.connect()
    try:
        tz = _tz(conn)
        day_start_hour = _day_start_hour(conn)
        today = timeutil.local_date_str(timeutil.now_ms(), tz)
        date_s = _date_arg("date", today)
        start, end = timeutil.day_bounds(date_s, day_start_hour, tz)
        now = timeutil.now_ms()
        rows = conn.execute(
            "SELECT e.*, c.name AS category_name, c.color AS category_color, c.icon AS category_icon"
            " FROM entries e JOIN categories c ON c.id = e.category_id"
            " WHERE (e.kind = 'timeline' AND e.started_at < ? AND (e.ended_at IS NULL OR e.ended_at > ?))"
            "    OR (e.kind = 'duration' AND e.started_at >= ? AND e.started_at < ?)"
            " ORDER BY e.started_at",
            (end, start, start, end),
        ).fetchall()

        entries = []
        per_category: dict[int, int] = {}
        total_ms = 0
        for row in rows:
            item = _entry_json(row, now)
            item["category_name"] = row["category_name"]
            item["category_color"] = row["category_color"]
            item["category_icon"] = row["category_icon"]
            if row["kind"] == "timeline":
                overlap = _overlap_ms(row["started_at"], item["effective_end"], start, end)
            else:
                overlap = _overlap_ms(row["started_at"], _effective_end(row, now), start, end)
            item["overlap_minutes"] = round(overlap / 60000)
            total_ms += overlap
            per_category[row["category_id"]] = per_category.get(row["category_id"], 0) + round(overlap / 60000)
            entries.append(item)

        return jsonify(
            {
                "date": date_s,
                "start_ms": start,
                "end_ms": end,
                "now": now,
                "entries": entries,
                "total_minutes": round(total_ms / 60000),
                "per_category": [
                    {"category_id": cid, "minutes": minutes} for cid, minutes in sorted(per_category.items())
                ],
                "days_with_data": _days_with_data(conn, end, tz, day_start_hour),
            }
        )
    finally:
        conn.close()


@bp.post("/timers/<int:category_id>/start")
def timer_start(category_id: int):
    conn = db.connect()
    try:
        _category(conn, category_id)
        now = timeutil.now_ms()
        with conn:
            current = _open_timer(conn)
            if current is not None and current["category_id"] == category_id:
                ended = max(now, current["started_at"] + MIN_ENTRY_MS)
                conn.execute(
                    "UPDATE entries SET ended_at = ?, updated_at = ? WHERE id = ?",
                    (ended, now, current["id"]),
                )
                conn.execute("UPDATE app_state SET running_entry_id = NULL, updated_at = ? WHERE id = 1", (now,))
                return jsonify({"action": "stopped", "stopped_id": current["id"], "entry": None})

            stopped_id = None
            if current is not None:
                ended = max(now, current["started_at"] + MIN_ENTRY_MS)
                conn.execute(
                    "UPDATE entries SET ended_at = ?, updated_at = ? WHERE id = ?",
                    (ended, now, current["id"]),
                )
                stopped_id = current["id"]

            cursor = conn.execute(
                "INSERT INTO entries (category_id, kind, started_at, ended_at, minutes, note, created_at, updated_at)"
                " VALUES (?, 'timeline', ?, NULL, NULL, '', ?, ?)",
                (category_id, now, now, now),
            )
            entry_id = cursor.lastrowid
            conn.execute(
                "UPDATE app_state SET running_entry_id = ?, updated_at = ? WHERE id = 1", (entry_id, now)
            )
            row = _entry(conn, entry_id)
        return jsonify({"action": "started", "stopped_id": stopped_id, "entry": _entry_json(row, now)})
    finally:
        conn.close()


@bp.post("/timers/stop")
def timer_stop():
    conn = db.connect()
    try:
        now = timeutil.now_ms()
        with conn:
            current = _open_timer(conn)
            if current is None:
                return jsonify({"action": "idle", "stopped_id": None})
            ended = max(now, current["started_at"] + MIN_ENTRY_MS)
            conn.execute(
                "UPDATE entries SET ended_at = ?, updated_at = ? WHERE id = ?", (ended, now, current["id"])
            )
            conn.execute("UPDATE app_state SET running_entry_id = NULL, updated_at = ? WHERE id = 1", (now,))
        return jsonify({"action": "stopped", "stopped_id": current["id"]})
    finally:
        conn.close()


@bp.post("/entries")
def create_entry():
    conn = db.connect()
    try:
        data = _json_body()
        category_id = int(data.get("category_id") or 0)
        _category(conn, category_id)
        tz = _tz(conn)
        started = timeutil.parse_ts(data.get("started_at"), tz)
        ended = timeutil.parse_ts(data.get("ended_at"), tz)
        if ended - started < MIN_ENTRY_MS:
            raise ApiError("Ende muss nach dem Start liegen")
        note = str(data.get("note", ""))[:4000]
        now = timeutil.now_ms()
        with conn:
            cursor = conn.execute(
                "INSERT INTO entries (category_id, kind, started_at, ended_at, minutes, note, created_at, updated_at)"
                " VALUES (?, 'timeline', ?, ?, NULL, ?, ?, ?)",
                (category_id, started, ended, note, now, now),
            )
            row = _entry(conn, cursor.lastrowid)
        return jsonify({"entry": _entry_json(row, now)}), 201
    finally:
        conn.close()


@bp.post("/entries/duration")
def create_duration():
    conn = db.connect()
    try:
        data = _json_body()
        category_id = int(data.get("category_id") or 0)
        _category(conn, category_id)
        tz = _tz(conn)
        day_start_hour = _day_start_hour(conn)
        date_s = str(data.get("date") or "")
        try:
            timeutil.parse_date(date_s)
        except ValueError as exc:
            raise ApiError(str(exc)) from exc
        minutes = _validate_minutes(data.get("minutes"))
        start, _ = timeutil.day_bounds(date_s, day_start_hour, tz)
        note = str(data.get("note", ""))[:4000]
        now = timeutil.now_ms()
        with conn:
            cursor = conn.execute(
                "INSERT INTO entries (category_id, kind, started_at, ended_at, minutes, note, created_at, updated_at)"
                " VALUES (?, 'duration', ?, NULL, ?, ?, ?, ?)",
                (category_id, start, minutes, note, now, now),
            )
            row = _entry(conn, cursor.lastrowid)
        return jsonify({"entry": _entry_json(row, now)}), 201
    finally:
        conn.close()


@bp.patch("/entries/<int:entry_id>")
def update_entry(entry_id: int):
    conn = db.connect()
    try:
        data = _json_body()
        row = _entry(conn, entry_id)
        tz = _tz(conn)
        fields: dict[str, object] = {}
        if "category_id" in data:
            category_id = int(data["category_id"])
            _category(conn, category_id)
            fields["category_id"] = category_id
        if "note" in data:
            fields["note"] = str(data["note"])[:4000]
        if row["kind"] == "timeline":
            started = timeutil.parse_ts(data["started_at"], tz) if "started_at" in data else row["started_at"]
            if "ended_at" in data:
                if data["ended_at"] is None:
                    raise ApiError("Laufende Timer werden über Start/Stop gesteuert")
                ended = timeutil.parse_ts(data["ended_at"], tz)
            else:
                ended = row["ended_at"]
            if ended is not None and ended - started < MIN_ENTRY_MS:
                raise ApiError("Ende muss nach dem Start liegen")
            if "started_at" in data:
                fields["started_at"] = started
            if "ended_at" in data:
                fields["ended_at"] = ended
        else:
            if "minutes" in data:
                fields["minutes"] = _validate_minutes(data["minutes"])
            if "date" in data:
                date_s = str(data["date"])
                try:
                    timeutil.parse_date(date_s)
                except ValueError as exc:
                    raise ApiError(str(exc)) from exc
                fields["started_at"] = timeutil.day_bounds(date_s, _day_start_hour(conn), tz)[0]
        if not fields:
            raise ApiError("Keine änderbaren Felder übergeben")
        fields["updated_at"] = timeutil.now_ms()
        assignments = ", ".join(f"{key} = ?" for key in fields)
        with conn:
            conn.execute(
                f"UPDATE entries SET {assignments} WHERE id = ?",
                (*fields.values(), entry_id),
            )
            row = _entry(conn, entry_id)
        return jsonify({"entry": _entry_json(row, timeutil.now_ms())})
    finally:
        conn.close()


@bp.delete("/entries/<int:entry_id>")
def delete_entry(entry_id: int):
    conn = db.connect()
    try:
        _entry(conn, entry_id)
        now = timeutil.now_ms()
        with conn:
            state = _state(conn)
            if state["running_entry_id"] == entry_id:
                conn.execute("UPDATE app_state SET running_entry_id = NULL, updated_at = ? WHERE id = 1", (now,))
            conn.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
        return jsonify({"ok": True, "deleted_id": entry_id})
    finally:
        conn.close()


@bp.get("/stats")
def get_stats():
    conn = db.connect()
    try:
        tz = _tz(conn)
        day_start_hour = _day_start_hour(conn)
        today = timeutil.local_date_str(timeutil.now_ms(), tz)
        from_s = _date_arg("from", (timeutil.parse_date(today) - timedelta(days=6)).isoformat())
        to_s = _date_arg("to", today)
        if to_s < from_s:
            raise ApiError("Das Enddatum liegt vor dem Startdatum")
        group_by = request.args.get("group_by", "category")
        if group_by not in ("category", "day"):
            raise ApiError("group_by muss 'category' oder 'day' sein")

        start, _ = timeutil.day_bounds(from_s, day_start_hour, tz)
        _, end = timeutil.day_bounds(to_s, day_start_hour, tz)
        now = timeutil.now_ms()
        rows = conn.execute(
            "SELECT e.*, c.name AS category_name, c.color AS category_color"
            " FROM entries e JOIN categories c ON c.id = e.category_id"
            " WHERE e.started_at < ? AND (e.kind = 'duration' OR e.ended_at IS NULL OR e.ended_at > ?)",
            (end, start),
        ).fetchall()

        categories = {cat["id"]: cat for cat in _categories_json(conn, include_archived=True)}
        by_category: dict[int, int] = {}
        total_ms = 0
        for row in rows:
            overlap = _overlap_ms(row["started_at"], _effective_end(row, now), start, end)
            if overlap <= 0:
                continue
            total_ms += overlap
            by_category[row["category_id"]] = by_category.get(row["category_id"], 0) + round(overlap / 60000)

        days = []
        cursor = timeutil.parse_date(from_s)
        last_day = timeutil.parse_date(to_s)
        while cursor <= last_day:
            d_start, d_end = timeutil.day_bounds(cursor.isoformat(), day_start_hour, tz)
            day_ms = 0
            for row in rows:
                day_ms += _overlap_ms(row["started_at"], _effective_end(row, now), d_start, d_end)
            days.append({"date": cursor.isoformat(), "minutes": round(day_ms / 60000)})
            cursor += timedelta(days=1)

        if group_by == "category":
            result_rows = [
                {
                    "key": str(cid),
                    "label": categories.get(cid, {}).get("name", f"#{cid}"),
                    "color": categories.get(cid, {}).get("color", "#8E8E93"),
                    "minutes": minutes,
                }
                for cid, minutes in by_category.items()
            ]
            result_rows.sort(key=lambda item: item["minutes"], reverse=True)
        else:
            result_rows = [
                {"key": item["date"], "label": item["date"], "color": "#0A84FF", "minutes": item["minutes"]}
                for item in days
            ]

        return jsonify(
            {
                "from": from_s,
                "to": to_s,
                "group_by": group_by,
                "total_minutes": round(total_ms / 60000),
                "rows": result_rows,
                "days": days,
            }
        )
    finally:
        conn.close()


@bp.get("/export.csv")
def export_csv():
    conn = db.connect()
    try:
        tz = _tz(conn)
        day_start_hour = _day_start_hour(conn)
        today = timeutil.local_date_str(timeutil.now_ms(), tz)
        from_s = _date_arg("from", (timeutil.parse_date(today) - timedelta(days=29)).isoformat())
        to_s = _date_arg("to", today)
        if to_s < from_s:
            raise ApiError("Das Enddatum liegt vor dem Startdatum")
        start, _ = timeutil.day_bounds(from_s, day_start_hour, tz)
        _, end = timeutil.day_bounds(to_s, day_start_hour, tz)
        now = timeutil.now_ms()
        rows = conn.execute(
            "SELECT e.*, c.name AS category_name"
            " FROM entries e JOIN categories c ON c.id = e.category_id"
            " WHERE e.started_at < ? AND (e.kind = 'duration' OR e.ended_at IS NULL OR e.ended_at > ?)"
            " ORDER BY e.started_at",
            (end, start),
        ).fetchall()

        delimiter = request.args.get("delimiter", ";")
        if delimiter not in (",", ";", "\t"):
            raise ApiError("delimiter muss ',', ';' oder Tab sein")

        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter=delimiter, lineterminator="\r\n")
        writer.writerow(["Datum", "Kategorie", "Start", "Ende", "Dauer (min)", "Dauer (h:mm)", "Notiz"])
        for row in rows:
            overlap = _overlap_ms(row["started_at"], _effective_end(row, now), start, end)
            if overlap <= 0:
                continue
            minutes = round(overlap / 60000)
            if row["kind"] == "timeline":
                row_start = timeutil.to_local(max(row["started_at"], start), tz)
                row_end = timeutil.to_local(min(_effective_end(row, now), end), tz)
                date_text = row_start.date().isoformat()
                start_text = row_start.strftime("%H:%M")
                end_text = row_end.strftime("%H:%M")
            else:
                row_start = timeutil.to_local(row["started_at"], tz)
                date_text = row_start.date().isoformat()
                start_text = ""
                end_text = ""
            writer.writerow(
                [
                    date_text,
                    _csv_safe(row["category_name"]),
                    start_text,
                    end_text,
                    minutes,
                    timeutil.fmt_duration(minutes),
                    _csv_safe(row["note"]),
                ]
            )

        payload = "\ufeff" + buffer.getvalue()
        filename = f"timeblocks-{from_s}_{to_s}.csv"
        return Response(
            payload,
            mimetype="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    finally:
        conn.close()


@bp.get("/categories")
def list_categories():
    conn = db.connect()
    try:
        include_archived = request.args.get("archived") == "1"
        return jsonify({"categories": _categories_json(conn, include_archived)})
    finally:
        conn.close()


@bp.post("/categories")
def create_category():
    conn = db.connect()
    try:
        data = _json_body()
        name = str(data.get("name", "")).strip()
        if not name:
            raise ApiError("Name fehlt")
        color = str(data.get("color", "#0A84FF"))
        if not (len(color) == 7 and color.startswith("#")):
            raise ApiError("Farbe muss als #RRGGBB angegeben werden")
        icon = str(data.get("icon", "dot"))[:40]
        parent_id = data.get("parent_id")
        if parent_id is not None:
            _category(conn, int(parent_id))
        goal = max(0, int(data.get("goal_minutes_week") or 0))
        now = timeutil.now_ms()
        with conn:
            order = conn.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories").fetchone()["n"]
            cursor = conn.execute(
                "INSERT INTO categories (name, color, icon, parent_id, goal_minutes_week, sort_order, archived, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
                (name, color, icon, parent_id, goal, order, now),
            )
            row = _category(conn, cursor.lastrowid)
        return jsonify({"category": dict(row)}), 201
    finally:
        conn.close()


@bp.patch("/categories/<int:category_id>")
def update_category(category_id: int):
    conn = db.connect()
    try:
        data = _json_body()
        _category(conn, category_id)
        fields: dict[str, object] = {}
        if "name" in data:
            name = str(data["name"]).strip()
            if not name:
                raise ApiError("Name darf nicht leer sein")
            fields["name"] = name
        if "color" in data:
            color = str(data["color"])
            if not (len(color) == 7 and color.startswith("#")):
                raise ApiError("Farbe muss als #RRGGBB angegeben werden")
            fields["color"] = color
        if "icon" in data:
            fields["icon"] = str(data["icon"])[:40]
        if "goal_minutes_week" in data:
            fields["goal_minutes_week"] = max(0, int(data["goal_minutes_week"] or 0))
        if "archived" in data:
            fields["archived"] = 1 if data["archived"] else 0
        if "sort_order" in data:
            fields["sort_order"] = int(data["sort_order"])
        if not fields:
            raise ApiError("Keine änderbaren Felder übergeben")
        assignments = ", ".join(f"{key} = ?" for key in fields)
        with conn:
            conn.execute(f"UPDATE categories SET {assignments} WHERE id = ?", (*fields.values(), category_id))
            row = _category(conn, category_id)
        return jsonify({"category": dict(row)})
    finally:
        conn.close()


@bp.delete("/categories/<int:category_id>")
def archive_category(category_id: int):
    conn = db.connect()
    try:
        _category(conn, category_id)
        now = timeutil.now_ms()
        with conn:
            running = _open_timer(conn)
            if running is not None and running["category_id"] == category_id:
                conn.execute(
                    "UPDATE entries SET ended_at = ?, updated_at = ? WHERE id = ?",
                    (max(now, running["started_at"] + MIN_ENTRY_MS), now, running["id"]),
                )
                conn.execute("UPDATE app_state SET running_entry_id = NULL, updated_at = ? WHERE id = 1", (now,))
            conn.execute("UPDATE categories SET archived = 1 WHERE id = ?", (category_id,))
        return jsonify({"ok": True, "archived_id": category_id})
    finally:
        conn.close()


@bp.put("/settings")
def update_settings():
    conn = db.connect()
    try:
        data = _json_body()
        fields: dict[str, object] = {}
        if "day_start_hour" in data:
            try:
                hour = int(data["day_start_hour"])
            except (TypeError, ValueError) as exc:
                raise ApiError("day_start_hour muss eine Zahl sein") from exc
            if hour < 0 or hour > 23:
                raise ApiError("day_start_hour muss zwischen 0 und 23 liegen")
            fields["day_start_hour"] = hour
        if "timezone" in data:
            tz_name = str(data["timezone"]).strip()
            if not timeutil.is_valid_tz(tz_name):
                raise ApiError("Unbekannte Zeitzone")
            fields["timezone"] = tz_name
        if not fields:
            raise ApiError("Keine änderbaren Felder übergeben")
        fields["updated_at"] = timeutil.now_ms()
        assignments = ", ".join(f"{key} = ?" for key in fields)
        with conn:
            conn.execute(f"UPDATE app_state SET {assignments} WHERE id = 1", (*fields.values(),))
        return jsonify({"ok": True, "state": dict(_state(conn))})
    finally:
        conn.close()
