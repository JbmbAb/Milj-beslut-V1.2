"""
import_lm_stac.py
Bulk-nedladdning och import av Lantmäteriet STAC vector-dataset till PostGIS.

Användning:
  python import_lm_stac.py byggnader          # Importerar alla 290 kommunpaket till topo10.byggnad
  python import_lm_stac.py fastighetsindelning # Importerar registerenhetsomradesyta -> env.registerenhetsomradesytor
  python import_lm_stac.py marktacke          # Importerar mark-lagret -> env.marktacke

Kräver:
  - LANTMATERIET_CONSUMER_KEY och LANTMATERIET_CONSUMER_SECRET i .env eller .env.local
  - GDAL (ogr2ogr) installerat på C:/Program Files/GDAL/
  - PostgreSQL kör på 127.0.0.1:5432
"""
import os, sys, subprocess, pathlib, json, zipfile, tempfile, time, urllib.request, urllib.parse
from datetime import datetime

# ── Konfiguration ─────────────────────────────────────────────────────────────
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
OGR = r"C:\Program Files\GDAL\ogr2ogr.exe"
TOKEN_URL = "https://api.lantmateriet.se/token"
STAC_BASE = "https://api.lantmateriet.se/stac-vektor/v1"
LOG_FILE = PROJECT_ROOT / "logs" / "lm_stac_import.log"
WORK_DIR = pathlib.Path(tempfile.gettempdir()) / "lm_stac_work"

# Dataset-konfiguration: collection -> (lager, målschema.tabell, geometrikolumn)
DATASETS = {
    "byggnader": {
        "layer": "byggnad",
        "table": "topo10.byggnad",
        "geom_col": "geometri",
    },
    "fastighetsindelning": {
        "layer": "registerenhetsomradesyta",
        "table": "env.registerenhetsomradesytor",
        "geom_col": "geom",
    },
    "marktacke": {
        "layer": "mark",
        "table": "env.marktacke",
        "geom_col": "geom",
    },
    "ortnamn": {
        "layer": "ortnamn",
        "table": "core.ortnamn",
        "geom_col": "geom",
    },
    "belagenhetsadresser": {
        "layer": "belagenhetsadress",
        "table": "core.belagenhetsadress",
        "geom_col": "geom",
    },
    "kommuner": {
        "collection": "kommun-lan-rike",
        "layer": "kommun",
        "table": "core.kommuner",
        "geom_col": "geom",
    },
    "lan": {
        "collection": "kommun-lan-rike",
        "layer": "lan",
        "table": "core.lan",
        "geom_col": "geom",
    },
    "rike": {
        "collection": "kommun-lan-rike",
        "layer": "rike",
        "table": "core.rike",
        "geom_col": "geom",
    },
}

# ── Läs credentials + DB-URL ─────────────────────────────────────────────────
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
DB_URL = _ENV.get("DATABASE_URL", "postgresql://miljobeslut:miljobeslut@localhost:5432/miljobeslut")

# Normalisera DB-URL för Windows ogr2ogr (key-value format)
DB_URL = (DB_URL
    .replace("@db:", "@127.0.0.1:")
    .replace("@postgres:", "@127.0.0.1:")
    .replace("@localhost:", "@127.0.0.1:"))
_pu = urllib.parse.urlparse(DB_URL)
DB_OGR = f"dbname='{_pu.path.lstrip('/')}' host='{_pu.hostname}' user='{_pu.username}' password='{_pu.password}' port='{_pu.port or 5432}'"

# ── Loggning ─────────────────────────────────────────────────────────────────
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
_log_fh = open(LOG_FILE, "a", encoding="utf-8")

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    _log_fh.write(line + "\n")
    _log_fh.flush()

# ── Token-hantering ──────────────────────────────────────────────────────────
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

def _fetch(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {get_token()}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def _download(url, dest: pathlib.Path):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {get_token()}"})
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as f:
        while True:
            chunk = resp.read(1 << 20)  # 1 MB
            if not chunk:
                break
            f.write(chunk)

# ── STAC-items ───────────────────────────────────────────────────────────────
def fetch_all_items(collection):
    items = []
    url = f"{STAC_BASE}/collections/{collection}/items?limit=300"
    while url:
        data = _fetch(url)
        items.extend(data.get("features", []))
        # Paginering
        url = None
        for link in data.get("links", []):
            if link.get("rel") == "next":
                url = link["href"]
                break
    return items

# ── Import-logik ─────────────────────────────────────────────────────────────
def ogr_import(gpkg: pathlib.Path, layer: str, table: str, geom_col: str, first: bool):
    mode = "-overwrite" if first else "-append"
    cmd = [
        OGR, "-f", "PostgreSQL", f"PG:{DB_OGR}",
        str(gpkg), layer,
        "-nln", table,
        mode,
        "-nlt", "PROMOTE_TO_MULTI",
        "-lco", "GEOMETRY_NAME=geom",
        "-lco", "SPATIAL_INDEX=NONE",
        "-gt", "65536",
        "--config", "PG_USE_COPY", "YES",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip()[:400])

def import_collection(collection: str):
    cfg = DATASETS[collection]
    layer = cfg["layer"]
    table = cfg["table"]
    geom_col = cfg["geom_col"]
    stac_collection = cfg.get("collection", collection)

    log(f"\n=== LM STAC: {collection} -> {table} ===")
    items = fetch_all_items(stac_collection)
    log(f"  {len(items)} kommunpaket hittade")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    first = True
    ok = err = 0

    for i, item in enumerate(items, 1):
        item_id = item["id"]
        href = item["assets"]["data"]["href"]
        zip_path = WORK_DIR / f"{collection}_{item_id}.zip"
        gpkg_name = zip_path.stem + ".gpkg"
        gpkg_path = WORK_DIR / gpkg_name

        try:
            log(f"  [{i}/{len(items)}] {item_id}: nedladdning...")
            _download(href, zip_path)

            with zipfile.ZipFile(zip_path) as zf:
                # Extrahera GPKG-filen till WORK_DIR
                for name in zf.namelist():
                    if name.endswith(".gpkg"):
                        zf.extract(name, WORK_DIR)
                        extracted = WORK_DIR / name
                        if extracted != gpkg_path:
                            extracted.rename(gpkg_path)
                        break

            log(f"  [{i}/{len(items)}] {item_id}: import -> {table}...")
            ogr_import(gpkg_path, layer, table, geom_col, first)
            first = False
            ok += 1
            log(f"  [{i}/{len(items)}] {item_id}: OK")
        except Exception as e:
            err += 1
            log(f"  [{i}/{len(items)}] {item_id}: FEL - {e}")
        finally:
            zip_path.unlink(missing_ok=True)
            gpkg_path.unlink(missing_ok=True)

    log(f"\n  Klart: {ok} OK, {err} fel")

    if err == 0 and ok > 0:
        # Bygg GiST-index
        log(f"  Bygger GiST-index på {table}...")
        schema, tblname = table.split(".")
        idx_cmd = ["docker", "exec", "miljobeslut-postgres", "psql", "-U", "miljobeslut", "-c",
                   f"CREATE INDEX IF NOT EXISTS {tblname}_geom_gist ON {table} USING GIST (geom); ANALYZE {table};"]
        subprocess.run(idx_cmd, capture_output=True)
        log("  Index klart")

# ── Main ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in DATASETS:
        print(f"Användning: python import_lm_stac.py <dataset>")
        print(f"Dataset: {', '.join(DATASETS)}")
        sys.exit(1)

    if not CONSUMER_KEY or not CONSUMER_SECRET:
        print("FEL: LANTMATERIET_CONSUMER_KEY och LANTMATERIET_CONSUMER_SECRET saknas i .env")
        sys.exit(1)

    log(f"=== LM STAC import startar: {sys.argv[1]} @ {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")
    import_collection(sys.argv[1])
    log(f"=== LM STAC import klar @ {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")
