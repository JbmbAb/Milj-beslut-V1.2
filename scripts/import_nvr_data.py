import io
import json
import logging
import os
import re
import shutil
import sys
import tempfile
import zipfile
from datetime import date, datetime
from pathlib import Path

import psycopg2
import requests
import shapefile
from psycopg2.extras import execute_values


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

BASE_DOWNLOAD_URL = "https://geodata.naturvardsverket.se/nedladdning/naturvardsregistret"
DB_DSN = os.environ.get("DATABASE_URL", "postgresql://postgres:password@localhost:5432/miljobeslut")

PROTECTED_AREA_SOURCES = [
    {"zip_name": "NP.zip", "shapefile_name": "NP_polygon.shp", "fallback_type": "Nationalpark"},
    {"zip_name": "NR.zip", "shapefile_name": "NR_polygon.shp", "fallback_type": "Naturreservat"},
    {"zip_name": "NVO.zip", "shapefile_name": "NVO_polygon.shp", "fallback_type": "Naturvardsomrade"},
    {"zip_name": "DVO.zip", "shapefile_name": "DVO_polygon.shp", "fallback_type": "Djur- och vaxtskyddsomrade"},
    {"zip_name": "NM.zip", "shapefile_name": "NM_polygon.shp", "fallback_type": "Naturminne"},
    {"zip_name": "KR.zip", "shapefile_name": "KR_polygon.shp", "fallback_type": "Kulturreservat"},
    {"zip_name": "VSO.zip", "shapefile_name": "VSO_polygon.shp", "fallback_type": "Vattenskyddsomrade"},
    {"zip_name": "OBO.zip", "shapefile_name": "OBO_polygon.shp", "fallback_type": "Ovrigt biotopskyddsomrade"},
    {"zip_name": "LBSO.zip", "shapefile_name": "LBSO_polygon.shp", "fallback_type": "Landskapsbildsskyddsomrade"},
    {"zip_name": "IF.zip", "shapefile_name": "IF_polygon.shp", "fallback_type": "Interimistiskt forbud"},
]

NATURA2000_SOURCES = [
    {"zip_name": "SCI_Rikstackande.zip", "category": "SCI"},
    {"zip_name": "SPA_Rikstackande.zip", "category": "SPA"},
]


def ensure_tables(conn):
    with conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS hydro;")
        cur.execute("CREATE SCHEMA IF NOT EXISTS env;")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS env.protected_area (
                nvr_id text,
                decision_status text,
                name text,
                protection_type text,
                decision_authority text,
                valid_from date,
                valid_to date,
                area_ha numeric,
                geom geometry(MultiPolygon, 3006),
                PRIMARY KEY (nvr_id, decision_status)
            );
            CREATE INDEX IF NOT EXISTS protected_area_geom_gix
            ON env.protected_area USING GIST (geom);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS env.natura2000_area (
                external_id text PRIMARY KEY,
                site_name text,
                site_code text,
                category text,
                geom geometry(MultiPolygon, 3006)
            );
            CREATE INDEX IF NOT EXISTS natura2000_area_geom_gix
            ON env.natura2000_area USING GIST (geom);
            """
        )
    conn.commit()


def parse_date(value):
    if value in (None, "", "0"):
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    if re.fullmatch(r"\d{8}", text):
        return f"{text[0:4]}-{text[4:6]}-{text[6:8]}"
    return None


def detect_encoding(shapefile_path):
    cpg_path = Path(shapefile_path).with_suffix(".cpg")
    if not cpg_path.exists():
        return "latin1"

    raw = cpg_path.read_text(encoding="utf-8", errors="ignore").strip().lower()
    if not raw:
        return "latin1"
    normalized = raw.replace("-", "").replace("_", "").replace(" ", "")
    if normalized in {"utf8"}:
        return "utf-8"
    if normalized in {"1252", "windows1252", "cp1252"}:
        return "cp1252"
    if normalized in {"latin1", "iso88591", "iso8859:1"}:
        return "latin1"
    return raw


def download_and_extract(zip_name):
    url = f"{BASE_DOWNLOAD_URL}/{zip_name}"
    logger.info("Hamta %s", url)
    response = requests.get(url, timeout=300)
    response.raise_for_status()

    temp_dir = Path(tempfile.mkdtemp(prefix="nvr_import_"))
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        archive.extractall(temp_dir)
    return temp_dir


def find_shapefiles(extract_dir, target_name=None):
    candidates = sorted(Path(extract_dir).rglob("*.shp"))
    if target_name is None:
        return candidates
    return [path for path in candidates if path.name.lower() == target_name.lower()]


def geom_to_json(shape):
    geom = shape.__geo_interface__
    geom_type = geom.get("type")
    if geom_type not in {"Polygon", "MultiPolygon"}:
        return None
    return json.dumps(geom)


def flush_protected_area_rows(conn, rows):
    if not rows:
        return

    query = """
        INSERT INTO env.protected_area (
            nvr_id,
            decision_status,
            name,
            protection_type,
            decision_authority,
            valid_from,
            valid_to,
            area_ha,
            geom
        )
        VALUES %s
        ON CONFLICT (nvr_id, decision_status)
        DO UPDATE SET
            name = EXCLUDED.name,
            protection_type = EXCLUDED.protection_type,
            decision_authority = EXCLUDED.decision_authority,
            valid_from = EXCLUDED.valid_from,
            valid_to = EXCLUDED.valid_to,
            area_ha = EXCLUDED.area_ha,
            geom = EXCLUDED.geom;
    """

    with conn.cursor() as cursor:
        execute_values(
            cursor,
            query,
            rows,
            template="(%s, %s, %s, %s, %s, %s, %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 3006)))",
            page_size=1000,
        )
    conn.commit()


def flush_natura_rows(conn, rows):
    if not rows:
        return

    query = """
        INSERT INTO env.natura2000_area (
            external_id,
            site_name,
            site_code,
            category,
            geom
        )
        VALUES %s
        ON CONFLICT (external_id)
        DO UPDATE SET
            site_name = EXCLUDED.site_name,
            site_code = EXCLUDED.site_code,
            category = EXCLUDED.category,
            geom = EXCLUDED.geom;
    """

    with conn.cursor() as cursor:
        execute_values(
            cursor,
            query,
            rows,
            template="(%s, %s, %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 3006)))",
            page_size=1000,
        )
    conn.commit()


def import_protected_area_source(conn, source):
    extract_dir = download_and_extract(source["zip_name"])
    imported = 0

    try:
        shapefiles = find_shapefiles(extract_dir, source["shapefile_name"])
        if not shapefiles:
            raise FileNotFoundError(f"Hittade inte {source['shapefile_name']} i {source['zip_name']}")

        for shapefile_path in shapefiles:
            encoding = detect_encoding(shapefile_path)
            logger.info("Laser %s med encoding %s", shapefile_path.name, encoding)
            reader = shapefile.Reader(str(shapefile_path), encoding=encoding)

            batch = []
            for shape_record in reader.iterShapeRecords():
                props = shape_record.record.as_dict()
                geom_json = geom_to_json(shape_record.shape)
                if geom_json is None:
                    continue

                nvr_id = str(props.get("NVRID") or "").strip()
                if not nvr_id:
                    continue

                decision_status = str(props.get("BESLSTATUS") or "Okand").strip() or "Okand"
                protection_type = str(props.get("SKYDDSTYP") or source["fallback_type"]).strip() or source["fallback_type"]
                name = str(props.get("NAMN") or "Namnlost omrade").strip() or "Namnlost omrade"
                decision_authority = props.get("BESLMYND")
                area_ha = props.get("AREA_HA")

                batch.append(
                    (
                        nvr_id,
                        decision_status,
                        name,
                        protection_type,
                        decision_authority,
                        parse_date(props.get("URSGALLDAT") or props.get("IKRAFTDATF")),
                        parse_date(props.get("SENGALLDAT")),
                        area_ha if area_ha not in ("", None) else None,
                        geom_json,
                    )
                )

                if len(batch) >= 1000:
                    flush_protected_area_rows(conn, batch)
                    imported += len(batch)
                    logger.info("Importerade %s rader fran %s", imported, source["zip_name"])
                    batch = []

            if batch:
                flush_protected_area_rows(conn, batch)
                imported += len(batch)

        logger.info("Klart %s: %s rader", source["zip_name"], imported)
        return imported
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)


def import_natura2000_source(conn, source):
    extract_dir = download_and_extract(source["zip_name"])
    imported = 0

    try:
        shapefiles = find_shapefiles(extract_dir)
        if not shapefiles:
            raise FileNotFoundError(f"Inga shapefiler hittades i {source['zip_name']}")

        for shapefile_path in shapefiles:
            encoding = detect_encoding(shapefile_path)
            logger.info("Laser %s med encoding %s", shapefile_path.name, encoding)
            reader = shapefile.Reader(str(shapefile_path), encoding=encoding)

            batch = []
            for shape_record in reader.iterShapeRecords():
                props = shape_record.record.as_dict()
                geom_json = geom_to_json(shape_record.shape)
                if geom_json is None:
                    continue

                site_code = str(props.get("SITE_CODE") or "").strip()
                if not site_code:
                    continue

                batch.append(
                    (
                        f"{source['category']}:{site_code}",
                        str(props.get("NAMN") or site_code).strip() or site_code,
                        site_code,
                        source["category"],
                        geom_json,
                    )
                )

                if len(batch) >= 1000:
                    flush_natura_rows(conn, batch)
                    imported += len(batch)
                    logger.info("Importerade %s rader fran %s", imported, source["zip_name"])
                    batch = []

            if batch:
                flush_natura_rows(conn, batch)
                imported += len(batch)

        logger.info("Klart %s: %s rader", source["zip_name"], imported)
        return imported
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)


def main():
    logger.info("Startar import av Naturvardsverket-data via direkta nedladdningar.")

    try:
        conn = psycopg2.connect(DB_DSN)
        logger.info("Ansluten till databas.")
    except Exception as exc:
        logger.error("Kunde inte ansluta till databasen: %s", exc)
        sys.exit(1)

    try:
        ensure_tables(conn)

        protected_total = 0
        for source in PROTECTED_AREA_SOURCES:
            protected_total += import_protected_area_source(conn, source)

        natura_total = 0
        for source in NATURA2000_SOURCES:
            natura_total += import_natura2000_source(conn, source)

        logger.info("Import klar. protected_area=%s, natura2000_area=%s", protected_total, natura_total)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
