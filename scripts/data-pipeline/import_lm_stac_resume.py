"""
import_lm_stac_resume.py
Bulk-nedladdning och import av Lantmäteriet STAC vector-dataset till PostGIS med RESUME stöd.

Användning:
  python import_lm_stac_resume.py byggnader
  python import_lm_stac_resume.py fastighetsytor
  python import_lm_stac_resume.py fastighetslinjer

Funktioner:
  - Hoppar över objekt som redan finns i en lokal manifest-fil.
  - Stöder flera lager från samma GPKG (t.ex. ytor och linjer).
"""
import os, sys, subprocess, pathlib, json, zipfile, tempfile, time, urllib.request, urllib.parse
from datetime import datetime

# ── Konfiguration ─────────────────────────────────────────────────────────────
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
OGR = r"C:\Program Files\GDAL\ogr2ogr.exe"
TOKEN_URL = "https://api.lantmateriet.se/token"
STAC_BASE = "https://api.lantmateriet.se/stac-vektor/v1"
LOG_DIR = PROJECT_ROOT / "logs"
WORK_DIR = pathlib.Path("D:\\GEodata\\Downloads_Archive")

DATASETS = {
    "byggnader": {
        "collection": "byggnader",
        "layer": "byggnad",
        "table": "topo10.byggnad",
    },
    "fastighetsytor": {
        "collection": "fastighetsindelning",
        "layer": "registerenhetsomradesyta",
        "table": "env.registerenhetsomradesytor",
    },
    "fastighetslinjer": {
        "collection": "fastighetsindelning",
        "layer": "registerenhetsomradeslinje",
        "table": "env.registerenhetsomradeslinjer",
    },
    "marktacke": {
        "collection": "marktacke",
        "layer": "mark",
        "table": "env.marktacke",
    },
    "ortnamn": {
        "collection": "ortnamn",
        "layer": "ortnamn",
        "table": "core.ortnamn",
    },
    "kommuner": {
        "collection": "kommun-lan-rike",
        "layer": "kommun",
        "table": "core.kommuner",
    },
    "lan": {
        "collection": "kommun-lan-rike",
        "layer": "lan",
        "table": "core.lan",
    },
    "rike": {
        "collection": "kommun-lan-rike",
        "layer": "rike",
        "table": "core.rike",
    }
}

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
DB_URL = _ENV.get("DATABASE_URL", "")

_pu = urllib.parse.urlparse(DB_URL)
DB_OGR = f"dbname='{_pu.path.lstrip('/')}' host='{_pu.hostname}' user='{_pu.username}' password='{_pu.password}' port='{_pu.port or 5432}'"

_token = None
_token_expires = 0

def get_token():
    global _token, _token_expires
    if _token and time.time() < _token_expires - 60:
        return _token
    
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    import base64
    creds = base64.b64encode(f"{CONSUMER_KEY}:{CONSUMER_SECRET}".encode()).decode()
    req = urllib.request.Request(TOKEN_URL, data=data,
                                  headers={"Authorization": f"Basic {creds}",
                                           "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read())
    _token = body["access_token"]
    _token_expires = time.time() + body.get("expires_in", 3600)
    return _token

def fetch_all_items(collection):
    items = []
    url = f"{STAC_BASE}/collections/{collection}/items?limit=300"
    while url:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {get_token()}"})
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
        items.extend(data.get("features", []))
        url = None
        for link in data.get("links", []):
            if link.get("rel") == "next":
                url = link["href"]
                break
    return items

def run_import(dataset_key):
    cfg = DATASETS[dataset_key]
    coll = cfg["collection"]
    layer = cfg["layer"]
    table = cfg["table"]
    
    log_file = LOG_DIR / f"lm_resume_{dataset_key}.json"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    
    completed = set()
    if log_file.exists():
        try:
            completed = set(json.loads(log_file.read_text()))
        except: pass

    print(f"=== LM RESUME: {dataset_key} -> {table} ===")
    items = fetch_all_items(coll)
    print(f"  Found {len(items)} items. {len(completed)} already done.")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    
    # Check if table exists to decide -overwrite vs -append
    first = True
    # In resume mode, we usually want to append unless it's the very first item ever.
    # But if we have 0 completed, we might want to overwrite.
    if len(completed) > 0:
        first = False

    for i, item in enumerate(items, 1):
        item_id = item["id"]
        if item_id in completed:
            continue
            
        href = item["assets"]["data"]["href"]
        zip_path = WORK_DIR / f"{item_id}.zip"
        
        try:
            if zip_path.exists():
                print(f"  [{i}/{len(items)}] {item_id}: ZIP already exists locally, skipping download.")
            else:
                print(f"  [{i}/{len(items)}] {item_id}: downloading...")
                req = urllib.request.Request(href, headers={"Authorization": f"Bearer {get_token()}"})
                with urllib.request.urlopen(req) as resp, open(zip_path, "wb") as f:
                    f.write(resp.read())
            
            with zipfile.ZipFile(zip_path) as zf:
                gpkg_name = [name for name in zf.namelist() if name.endswith(".gpkg")][0]
                zf.extract(gpkg_name, WORK_DIR)
                gpkg_path = WORK_DIR / gpkg_name

            mode = "-overwrite" if first else "-append"
            cmd = [
                OGR, "-f", "PostgreSQL", f"PG:{DB_OGR}",
                str(gpkg_path), layer,
                "-nln", table,
                mode,
                "-nlt", "PROMOTE_TO_MULTI",
                "-lco", "GEOMETRY_NAME=geom",
                "-lco", "SPATIAL_INDEX=NONE",
                "-gt", "65536",
                "--config", "PG_USE_COPY", "YES",
            ]
            
            print(f"  [{i}/{len(items)}] {item_id}: importing {layer}...")
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode != 0:
                print(f"  [ERROR] {item_id}: {res.stderr[:200]}")
                continue
            
            first = False
            completed.add(item_id)
            log_file.write_text(json.dumps(list(completed)))
            print(f"  [{i}/{len(items)}] {item_id}: OK")
            
        except Exception as e:
            print(f"  [ERROR] {item_id}: {e}")
        finally:
            # Keep zip on D: as permanent archive
            # if zip_path.exists(): zip_path.unlink()
            # clean work dir gpkgs
            for p in WORK_DIR.glob("*.gpkg"): p.unlink()

    print(f"Done! {len(completed)}/{len(items)} completed.")

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in DATASETS:
        print(f"Usage: python import_lm_stac_resume.py <dataset>")
        print(f"Datasets: {', '.join(DATASETS.keys())}")
        sys.exit(1)
    run_import(sys.argv[1])
