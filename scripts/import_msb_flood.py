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
# MSB INSPIRE WFS för översvämningskartering
WFS_URL = "https://inspire.msb.se/oversvamning/wfs"

# PostGIS anslutningssträng
DB_DSN = os.environ.get("DATABASE_URL", "postgresql://postgres:password@localhost:5432/miljobeslut")

# Lager att hämta.
# OBS: Lagernamn kan variera beroende på MSB:s publicering.
# Kontrollera gärna via GetCapabilities om dessa inte ger träff:
# https://inspire.msb.se/oversvamning/wfs?request=GetCapabilities&service=WFS
LAYERS_TO_SYNC = [
    {"layer": "Oversvamning_100ar", "type": "100-årsflöde"},
    {"layer": "Oversvamning_200ar", "type": "200-årsflöde"},
    {"layer": "Oversvamning_max", "type": "Beräknat högsta flöde"}
]

def get_wfs_features(layer_name):
    """Hämtar features från WFS som GeoJSON i SWEREF 99 TM (EPSG:3006)."""
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": layer_name,
        "outputFormat": "application/json",
        "srsName": "EPSG:3006"
    }
    
    logger.info(f"Hämtar lager: {layer_name}...")
    try:
        response = requests.get(WFS_URL, params=params, timeout=120)
        response.raise_for_status()
        
        # Kontrollera att vi fick JSON och inte ett XML-felmeddelande
        content_type = response.headers.get('Content-Type', '')
        if 'json' not in content_type:
            logger.warning(f"Varning: Fick svar med typ {content_type} istället för JSON. Svaret kan vara ett felmeddelande.")
            # Fortsätt ändå och försök parsa, ibland är headers fel

        data = response.json()
        count = len(data.get('features', []))
        logger.info(f"Hämtade {count} objekt från {layer_name}.")
        return data
    except Exception as e:
        logger.error(f"Fel vid hämtning av {layer_name}: {e}")
        return None

def insert_features(conn, features, return_period):
    """Infogar features i PostGIS-tabellen climate.flood_risk_area."""
    if not features:
        return

    cursor = conn.cursor()
    rows = []
    
    for f in features:
        props = f.get("properties", {})
        geom = f.get("geometry")
        
        if not geom:
            continue

        # Försök hitta ett unikt ID, annars generera ett
        ext_id = str(f.get("id") or props.get("gml_id") or f"{return_period}_{len(rows)}")
        
        geom_json = json.dumps(geom)

        rows.append((
            ext_id,
            "MSB",
            return_period,
            geom_json
        ))

    if not rows:
        return

    insert_query = """
        INSERT INTO climate.flood_risk_area (
            external_id, source, return_period, geom
        )
        VALUES %s
        ON CONFLICT (external_id) 
        DO UPDATE SET
            source = EXCLUDED.source,
            return_period = EXCLUDED.return_period,
            geom = EXCLUDED.geom;
    """

    try:
        execute_values(
            cursor, insert_query, rows,
            template="(%s, %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 3006)))",
            page_size=1000
        )
        conn.commit()
        logger.info(f"Infogade/uppdaterade {len(rows)} rader för {return_period}.")
    except Exception as e:
        conn.rollback()
        logger.error(f"Fel vid databas-insert för {return_period}: {e}")

def main():
    logger.info("Startar import av MSB översvämningsdata...")
    try:
        conn = psycopg2.connect(DB_DSN)
        logger.info("Ansluten till databas.")
    except Exception as e:
        logger.error(f"Kunde inte ansluta till databasen: {e}")
        sys.exit(1)

    # Säkerställ att schema och tabell finns
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS climate;")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS climate.flood_risk_area (
                    external_id text PRIMARY KEY,
                    source text,
                    return_period text,
                    geom geometry(MultiPolygon, 3006)
                );
                CREATE INDEX IF NOT EXISTS flood_risk_area_geom_gix ON climate.flood_risk_area USING GIST (geom);
            """)
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Kunde inte initiera tabeller: {e}")
        sys.exit(1)

    for layer_info in LAYERS_TO_SYNC:
        data = get_wfs_features(layer_info["layer"])
        if data and "features" in data:
            insert_features(conn, data["features"], layer_info["type"])
    
    conn.close()
    logger.info("Import klar.")

if __name__ == "__main__":
    main()