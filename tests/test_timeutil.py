from datetime import date, datetime, timedelta

import pytest

import timeutil


def test_day_bounds_regular_day():
    start, end = timeutil.day_bounds("2026-11-10", 0, "Europe/Berlin")
    assert end - start == 24 * 3600 * 1000
    assert timeutil.to_local(start, "Europe/Berlin").hour == 0
    assert timeutil.to_local(end, "Europe/Berlin").date() == date(2026, 11, 11)


def test_day_bounds_spring_dst_is_23_hours():
    start, end = timeutil.day_bounds("2026-03-29", 0, "Europe/Berlin")
    assert end - start == 23 * 3600 * 1000


def test_day_bounds_autumn_dst_is_25_hours():
    start, end = timeutil.day_bounds("2026-10-25", 0, "Europe/Berlin")
    assert end - start == 25 * 3600 * 1000


def test_day_start_hour_shifts_boundaries():
    start, end = timeutil.day_bounds("2026-11-10", 4, "Europe/Berlin")
    start_local = timeutil.to_local(start, "Europe/Berlin")
    end_local = timeutil.to_local(end, "Europe/Berlin")
    assert (start_local.hour, start_local.minute) == (4, 0)
    assert end_local.date() == date(2026, 11, 11)
    assert (end_local.hour, end_local.minute) == (4, 0)


def test_parse_ts_naive_uses_configured_zone():
    ms = timeutil.parse_ts("2026-11-10T09:30", "Europe/Berlin")
    local = timeutil.to_local(ms, "Europe/Berlin")
    assert (local.hour, local.minute) == (9, 30)


def test_parse_ts_accepts_epoch_ms():
    assert timeutil.parse_ts(1794305602290, "Europe/Berlin") == 1794305602290


def test_parse_ts_rejects_garbage():
    with pytest.raises(ValueError):
        timeutil.parse_ts("morgen früh", "Europe/Berlin")


def test_fmt_duration():
    assert timeutil.fmt_duration(0) == "0m"
    assert timeutil.fmt_duration(45) == "45m"
    assert timeutil.fmt_duration(60) == "1h 00m"
    assert timeutil.fmt_duration(185) == "3h 05m"


def test_local_date_str_around_midnight():
    start, end = timeutil.day_bounds("2026-11-10", 0, "Europe/Berlin")
    assert timeutil.local_date_str(start, "Europe/Berlin") == "2026-11-10"
    assert timeutil.local_date_str(end - 1, "Europe/Berlin") == "2026-11-10"
    assert timeutil.local_date_str(end, "Europe/Berlin") == "2026-11-11"


def test_is_valid_tz():
    assert timeutil.is_valid_tz("Europe/Berlin")
    assert not timeutil.is_valid_tz("Mars/Olympus")


def test_logical_date_before_day_start():
    tz = "Europe/Berlin"
    start, _ = timeutil.day_bounds("2026-03-15", 0, tz)
    now = start + 2 * 3600000  # 02:00, Tagesbeginn ist 04:00
    assert timeutil.logical_date_str(now, 4, tz) == "2026-03-14"
    assert timeutil.logical_date_str(now, 0, tz) == "2026-03-15"
