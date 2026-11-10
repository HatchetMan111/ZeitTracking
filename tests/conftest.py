import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app"))
os.environ.setdefault("TIMEBLOCKS_DATA_DIR", tempfile.mkdtemp(prefix="timeblocks-tests-"))

import app as app_module  # noqa: E402
import db  # noqa: E402


@pytest.fixture()
def client():
    db.init_db()
    conn = db.connect()
    try:
        conn.execute("DELETE FROM entries")
        conn.execute("DELETE FROM categories")
        conn.execute("DELETE FROM app_state")
        conn.commit()
    finally:
        conn.close()
    db.init_db()
    app_module.app.config.update(TESTING=True)
    with app_module.app.test_client() as test_client:
        yield test_client


def day_payload(client, date_value=None):
    query = f"?date={date_value}" if date_value else ""
    response = client.get(f"/api/day{query}")
    assert response.status_code == 200
    return response.get_json()
