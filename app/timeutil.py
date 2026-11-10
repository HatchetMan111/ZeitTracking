"""Timezone-aware day boundaries and timestamp helpers.

All timestamps are stored as UTC epoch milliseconds. Local days are derived
from an IANA timezone and an optional day start hour (e.g. 4 = 04:00).
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = ZoneInfo("UTC")


def now_ms() -> int:
    return int(time.time() * 1000)


def get_tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def is_valid_tz(name: str) -> bool:
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return False


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Ungültiges Datum: {value!r} (erwartet YYYY-MM-DD)") from exc


def day_bounds(date_value: str, day_start_hour: int = 0, tz_name: str = "UTC") -> tuple[int, int]:
    d = parse_date(date_value)
    tz = get_tz(tz_name)
    start = datetime(d.year, d.month, d.day, day_start_hour, tzinfo=tz)
    end = start + timedelta(days=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def to_local(ms: int, tz_name: str) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=get_tz(tz_name))


def local_date_str(ms: int, tz_name: str) -> str:
    return to_local(ms, tz_name).date().isoformat()


def fmt_local(ms: int, tz_name: str, fmt: str = "%Y-%m-%dT%H:%M") -> str:
    return to_local(ms, tz_name).strftime(fmt)


def parse_ts(value, tz_name: str) -> int:
    if isinstance(value, bool):
        raise ValueError("Boolescher Zeitstempel ist nicht erlaubt")
    if isinstance(value, (int, float)):
        return int(value)
    if value is None:
        raise ValueError("Zeitstempel fehlt")
    text = str(value).strip()
    if not text:
        raise ValueError("Zeitstempel ist leer")
    if text.isdigit():
        return int(text)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"Ungültiger Zeitstempel: {value!r}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=get_tz(tz_name))
    return int(dt.timestamp() * 1000)


def fmt_duration(minutes: int | float) -> str:
    total = int(round(minutes))
    hours, mins = divmod(max(0, total), 60)
    if hours:
        return f"{hours}h {mins:02d}m"
    return f"{mins}m"


def day_length_ms(date_value: str, day_start_hour: int, tz_name: str) -> int:
    start, end = day_bounds(date_value, day_start_hour, tz_name)
    return end - start


def logical_date_str(ms: int, day_start_hour: int, tz_name: str) -> str:
    day = local_date_str(ms, tz_name)
    start, _ = day_bounds(day, day_start_hour, tz_name)
    if ms < start:
        day = (parse_date(day) - timedelta(days=1)).isoformat()
    return day
