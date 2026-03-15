import os
import sys
import logging
import requests
import json
import psycopg2
from psycopg2.extras import execute_values

# Dependencies:
# pip install requests psycopg2-binary

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Konfiguration
# RAÄ (Riksantikvarieämbetet) Publik WFS
WFS_URL = "https://pub.raa.se/geoserver/wfs"

# PostGIS anslutningssträng
DB_DSN = os.environ.get("DATABASE_URL", "postgresql://postgres:password@localhost:5432/miljobeslut")

# Lager att hämta (Namespace 'raap' används ofta för publika lager)
LAYERS_TO_SYNC = [
    {"layer": "raap:lamning", "type": "Lämning (Punkt)"},
    {"layer": "raap:lamningsyta", "type": "Lämning (Yta)"}
]

def get_wfs_features(layer_name, max_features=5000):
    """Hämtar features från WFS som GeoJSON i SWEREF 99 TM (EPSG:3006)."""
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": layer_name,
        "outputFormat": "application/json",
        "srsName": "EPSG:3006",
        "count": max_features # Begränsning för att undvika timeout i demo
    }
    
    logger.info(f"Hämtar lager: {layer_name} (max {max_features})...")
    try:
        response = requests.get(WFS_URL, params=params, timeout=120)
        response.raise_for_status()
        
        if 'json' not in response.headers.get('Content-Type', ''):
             logger.warning(f"Varning: Fick svar med typ {response.headers.get('Content-Type')} istället för JSON.")
        
        data = response.json()
        count = len(data.get('features', []))
        logger.info(f"Hämtade {count} objekt från {layer_name}.")
        return data
    except Exception as e:
        logger.error(f"Fel vid hämtning av {layer_name}: {e}")
        return None

def insert_features(conn, features):
    """Infogar features i PostGIS-tabellen culture.heritage_object."""
    if not features:
        return

    cursor = conn.cursor()
    rows = []
    
    for f in features:
        props = f.get("properties", {})
        geom = f.get("geometry")
        
        if not geom:
            continue

        # Mappa attribut (RAÄ-specifika fält)
        ext_id = str(f.get("id") or props.get("lamning_id") or props.get("id", ""))
        obj_type = props.get("lamningstyp") or "Okänd"
        name = props.get("namn") or props.get("raa_nummer") or "Namnlös"
        protection = props.get("antikvarisk_bedomning") or "Okänd"
        
        geom_json = json.dumps(geom)

        rows.append((
            ext_id,
            obj_type,
            name,
            protection,
            geom_json
        ))

    if not rows:
        return

    insert_query = """
        INSERT INTO culture.heritage_object (
            external_id, object_type, name, protection_class, geom
        )
        VALUES %s
        ON CONFLICT (external_id) 
        DO UPDATE SET
            object_type = EXCLUDED.object_type,
            name = EXCLUDED.name,
            protection_class = EXCLUDED.protection_class,
            geom = EXCLUDED.geom;
    """

    try:
        # Använder ST_SetSRID för att tvinga 3006
        execute_values(
            cursor, insert_query, rows,
            template="(%s, %s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 3006))",
            page_size=1000
        )
        conn.commit()
        logger.info(f"Infogade/uppdaterade {len(rows)} rader.")
    except Exception as e:
        conn.rollback()
        logger.error(f"Fel vid databas-insert: {e}")

def main():
    logger.info("Startar import av RAÄ fornlämningsdata...")
    try:
        conn = psycopg2.connect(DB_DSN)
        logger.info("Ansluten till databas.")
    except Exception as e:
        logger.error(f"Kunde inte ansluta till databasen: {e}")
        sys.exit(1)

    # Säkerställ schema och tabell
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS culture;")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS culture.heritage_object (
                    external_id text PRIMARY KEY,
                    object_type text,
                    name text,
                    protection_class text,
                    geom geometry(Geometry, 3006)
                );
                CREATE INDEX IF NOT EXISTS heritage_object_geom_gix ON culture.heritage_object USING GIST (geom);
            """)
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Kunde inte initiera tabeller: {e}")
        sys.exit(1)

    for layer_info in LAYERS_TO_SYNC:
        data = get_wfs_features(layer_info["layer"])
        if data and "features" in data:
            insert_features(conn, data["features"])
    
    conn.close()
    logger.info("Import klar.")

if __name__ == "__main__":
    main()