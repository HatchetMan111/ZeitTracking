import json
import re

ASSET_RE = re.compile(r'(?:src|href)="(/static/assets/[^"]+)"')


def test_index_no_cache(client):
    response = client.get("/")
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    assert 'id="root"' in body
    assert "no-cache" in response.headers["Cache-Control"]


def test_hashed_assets_immutable(client):
    index = client.get("/")
    assets = ASSET_RE.findall(index.get_data(as_text=True))
    assert assets
    for path in assets:
        response = client.get(path)
        assert response.status_code == 200, path
        mimetype = response.headers["Content-Type"]
        if path.endswith(".js"):
            assert "javascript" in mimetype
        elif path.endswith(".css"):
            assert "css" in mimetype
        assert "immutable" in response.headers["Cache-Control"]


def test_static_misses_are_json_404(client):
    for path in ("/static/app.js", "/static/assets/nope.js"):
        response = client.get(path)
        assert response.status_code == 404, path
        assert response.mimetype == "application/json"
        assert "text/html" not in response.headers["Content-Type"]
        assert response.get_json() == {"error": "Nicht gefunden"}


def test_service_worker(client):
    response = client.get("/sw.js")
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    assert "timeblocks-v4" in body
    assert "no-cache" in response.headers["Cache-Control"]
    assert response.headers["Service-Worker-Allowed"] == "/"


def test_manifest_and_icons(client):
    response = client.get("/manifest.webmanifest")
    assert response.status_code == 200
    assert response.mimetype == "application/manifest+json"
    manifest = json.loads(response.get_data(as_text=True))
    for icon in manifest["icons"]:
        icon_response = client.get(icon["src"])
        assert icon_response.status_code == 200, icon["src"]


def test_favicon(client):
    assert client.get("/favicon.ico").status_code == 200
