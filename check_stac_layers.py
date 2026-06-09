 import os, sys, subprocess, pathlib, json, zipfile, tempfile, time, urllib.request, urllib.parse
from datetime import datetime

# ── Konfiguration ─────────────────────────────────────────────────────────────
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent
OGR = r"C:\Program Files\GDAL\ogr2ogr.exe"
OGRINFO = r"C:\Program Files\GDAL\ogrinfo.exe"
TOKEN_URL = "https://api.lantmateriet.se/token"
STAC_BASE = "https://api.lantmateriet.se/stac-vektor/v1"
WORK_DIR = pathlib.Path(tempfile.gettempdir()) / "lm_stac_test"

def _load_env():
    env = {}
    for f in [PROJECT_ROOT / ".env.local", PROJECT_ROOT / ".env"]:
        if f.exists():
            for line in f.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    env.setdefault(k.strip(), v.strip())
    return env

_ENV = _load_env()
CONSUMER_KEY = _ENV.get("LANTMATERIET_CONSUMER_KEY", "")
CONSUMER_SECRET = _ENV.get("LANTMATERIET_CONSUMER_SECRET", "")

def get_token():
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    import base64
    creds = base64.b64encode(f"{CONSUMER_KEY}:{CONSUMER_SECRET}".encode()).decode()
    req = urllib.request.Request(TOKEN_URL, data=data,
                                  headers={"Authorization": f"Basic {creds}",
                                           "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read())
    return body["access_token"]

def download_and_check():
    token = get_token()
    # Hämta Hässleholm (1293) fastighetsindelning
    url = f"{STAC_BASE}/collections/fastighetsindelning/items/1293"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as resp:
        item = json.loads(resp.read())
    
    href = item["assets"]["data"]["href"]
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = WORK_DIR / "test.zip"
    
    print(f"Downloading {href}...")
    req = urllib.request.Request(href, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as resp, open(zip_path, "wb") as f:
        f.write(resp.read())
    
    print("Extracting...")
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if name.endswith(".gpkg"):
                zf.extract(name, WORK_DIR)
                gpkg_path = WORK_DIR / name
                break
    
    print(f"Checking layers in {gpkg_path}...")
    cmd = [OGRINFO, "-so", str(gpkg_path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    print(result.stdout)

if __name__ == "__main__":
    download_and_check()
