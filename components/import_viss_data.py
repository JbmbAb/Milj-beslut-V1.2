import json
import logging
import os
import sys
from pathlib import Path

import psycopg2
import requests
from psycopg2.extras import execute_values

# Dependencies:
# pip install requests psycopg2-binary

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WFS_URL = 'https://ext-geodata.lansstyrelsen.se/viss/wfs'
DEFAULT_LAYER_NAME = 'ms:viss_vattendirektivet_ytvatten'
DEFAULT_TIMEOUT_SECONDS = 180
DEFAULT_DB_DSN = 'postgresql://postgres:password@localhost:5432/miljobeslut'


def load_env_file(env_path: Path) -> None:
    """Load a simple .env file without overriding existing environment variables."""
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue

        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def masked_secret(secret: str) -> str:
    if not secret:
        return '<missing>'
    if len(secret) <= 8:
        return '*' * len(secret)
    return f'{secret[:4]}...{secret[-4:]}'


load_env_file(PROJECT_ROOT / '.env')

WFS_URL = os.environ.get('VISS_WFS_URL', DEFAULT_WFS_URL).strip()
LAYER_NAME = os.environ.get('VISS_LAYER_NAME', DEFAULT_LAYER_NAME).strip()
VISS_API_KEY = os.environ.get('VISS_API_KEY', '').strip()
REQUEST_TIMEOUT_SECONDS = int(os.environ.get('VISS_TIMEOUT_SECONDS', str(DEFAULT_TIMEOUT_SECONDS)))
REQUIRE_API_KEY = parse_bool(os.environ.get('VISS_REQUIRE_API_KEY'), default=True)
DB_DSN = os.environ.get('DATABASE_URL', DEFAULT_DB_DSN)


def get_wfs_features(layer_name: str):
    """Fetch features from VISS WFS as GeoJSON in SWEREF 99 TM (EPSG:3006)."""
    headers = {
        'Accept': 'application/json',
    }
    params = {
        'service': 'WFS',
        'version': '2.0.0',
        'request': 'GetFeature',
        'typeNames': layer_name,
        'outputFormat': 'application/json',
        'srsName': 'EPSG:3006',
    }

    if VISS_API_KEY:
        # The VISS Open API documentation mentions apikey in the query string.
        # The public console also exposes an apikey header, so we send both.
        params['apikey'] = VISS_API_KEY
        headers['apikey'] = VISS_API_KEY

    logger.info('Fetching VISS layer %s from %s', layer_name, WFS_URL)
    response = requests.get(WFS_URL, params=params, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()

    try:
        data = response.json()
    except ValueError as exc:
        snippet = response.text[:400].replace('\n', ' ')
        raise RuntimeError(f'VISS WFS did not return JSON. Snippet: {snippet}') from exc

    feature_count = len(data.get('features', []))
    logger.info('Fetched %s features from %s', feature_count, layer_name)
    return data


def insert_features(conn, features):
    """Insert VISS features into hydro.water_body."""
    if not features:
        logger.warning('No VISS features were returned. Nothing to insert.')
        return

    cursor = conn.cursor()
    rows = []

    for feature in features:
        props = feature.get('properties', {})
        geom = feature.get('geometry')

        if not geom:
            continue

        ext_id = props.get('EU_CD_WB')
        name = props.get('VATTENFOREKOMSTNAMN')
        water_type = props.get('VATTENFOREKOMSTTYP_NAMN')
        eco_status = props.get('EKOLOGISK_STATUS_KLASS')
        chem_status = props.get('KEMISK_YTTERLIGARE_STATUS_KLASS')

        if not ext_id:
            continue

        rows.append((
            ext_id,
            name,
            water_type,
            eco_status,
            chem_status,
            json.dumps(geom),
        ))

    if not rows:
        logger.warning('No VISS rows had a usable external_id. Nothing to insert.')
        return

    insert_query = """
        INSERT INTO hydro.water_body (
            external_id, name, water_type, status_ecological, status_chemical, geom
        )
        VALUES %s
        ON CONFLICT (external_id)
        DO UPDATE SET
            name = EXCLUDED.name,
            water_type = EXCLUDED.water_type,
            status_ecological = EXCLUDED.status_ecological,
            status_chemical = EXCLUDED.status_chemical,
            geom = EXCLUDED.geom;
    """

    try:
        execute_values(
            cursor,
            insert_query,
            rows,
            template='(%s, %s, %s, %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 3006)))',
            page_size=500,
        )
        conn.commit()
        logger.info('Inserted/updated %s water bodies', len(rows))
    except Exception as exc:
        conn.rollback()
        logger.error('Database insert failed for VISS import: %s', exc)
        raise


def ensure_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute('CREATE SCHEMA IF NOT EXISTS hydro;')
        cur.execute(
            'CREATE TABLE IF NOT EXISTS hydro.water_body ('
            'external_id text PRIMARY KEY, '
            'name text, '
            'water_type text, '
            'status_ecological text, '
            'status_chemical text, '
            'geom geometry(Geometry, 3006)'
            ');'
        )
        cur.execute('CREATE INDEX IF NOT EXISTS water_body_geom_gix ON hydro.water_body USING GIST (geom);')
        conn.commit()


def main() -> None:
    logger.info('Starting VISS water body import')
    logger.info(
        'VISS auth configured with key %s, endpoint %s, layer %s',
        masked_secret(VISS_API_KEY),
        WFS_URL,
        LAYER_NAME,
    )

    if REQUIRE_API_KEY and not VISS_API_KEY:
        logger.error(
            'VISS_API_KEY is missing. This importer does not use anonymous fallback. '
            'Set VISS_API_KEY in the environment or .env before running the import.'
        )
        sys.exit(2)

    try:
        conn = psycopg2.connect(DB_DSN)
    except Exception as exc:
        logger.error('Could not connect to database: %s', exc)
        sys.exit(1)

    try:
        ensure_schema(conn)
        data = get_wfs_features(LAYER_NAME)
        if data and 'features' in data:
            insert_features(conn, data['features'])
    except Exception as exc:
        logger.error('VISS import failed: %s', exc)
        sys.exit(1)
    finally:
        conn.close()

    logger.info('VISS import complete')


if __name__ == '__main__':
    main()
