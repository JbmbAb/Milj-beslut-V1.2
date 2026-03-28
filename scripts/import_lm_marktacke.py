import glob
import io
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

# Dependencies:
# - Python: pip install requests
# - System: raster2pgsql, psql (från PostGIS/PostgreSQL installation)
import requests

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Konfiguration ---

# OBS: Denna data är Nationella Marktäckedata (NMD) från Naturvårdsverket,
# men är grupperad under Lantmäteriet enligt projektets datakällor.
# URL till ett regionalt exempel (Västerbotten). Uppdatera för nationell täckning.
DATA_URL = "https://geodata.naturvardsverket.se/nedladdning/marktackedata/NMD_Vasterbotten_2018_geotiff_sweref99tm.zip"

# PostGIS anslutningssträng (används av psql)
DB_DSN = os.environ.get("DATABASE_URL", "postgresql://postgres:password@localhost:5432/miljobeslut")

# Mål-schema och tabell i databasen
TARGET_SCHEMA = "env"
TARGET_TABLE = "marktacke"
RASTER_TABLE_FULL = f"{TARGET_SCHEMA}.{TARGET_TABLE}"

# Tiling-storlek för raster-importen
RASTER_TILE_SIZE = os.environ.get("LM_MARKTACKE_TILE_SIZE", "256x256")
TEMP_DIR_PREFIX = "marktacke_"
PGOPTIONS = os.environ.get(
    "PGOPTIONS",
    "-c synchronous_commit=off -c maintenance_work_mem=1GB -c work_mem=128MB"
)

def run_psql_sql(db_dsn, sql):
    env = os.environ.copy()
    env["PGOPTIONS"] = PGOPTIONS
    result = subprocess.run(
        ["psql", db_dsn, "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    if result.returncode != 0:
        logger.error(result.stderr.strip())
        return False
    return True

def ensure_postgis_prerequisites(db_dsn):
    logger.info("Säkerställer schema och PostGIS-extension...")
    sql = f"""
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE SCHEMA IF NOT EXISTS {TARGET_SCHEMA};
    """
    return run_psql_sql(db_dsn, sql)

def download_and_unzip(url, target_dir):
    """Laddar ner och packar upp zip-fil till en specifik mapp."""
    logger.info(f"Laddar ner data från {url}...")
    try:
        response = requests.get(url, stream=True, timeout=600) # Längre timeout för stora filer
        response.raise_for_status()
        
        with zipfile.ZipFile(io.BytesIO(response.content)) as z:
            logger.info(f"Packar upp {os.path.basename(url)}...")
            z.extractall(target_dir)
            logger.info(f"Data uppackad till {target_dir}")
            
            # Hitta den uppackade .tif-filen
            tif_files = glob.glob(os.path.join(target_dir, '**', '*.tif'), recursive=True)
            if not tif_files:
                raise FileNotFoundError("Ingen .tif-fil hittades i zip-arkivet.")
            
            return tif_files[0]
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Nätverksfel vid nedladdning: {e}")
        return None
    except Exception as e:
        logger.error(f"Fel vid uppackning: {e}")
        return None

def import_raster_to_postgis(db_dsn, geotiff_path):
    """
    Importerar en GeoTIFF-fil till PostGIS med raster2pgsql.
    Kräver att 'raster2pgsql' och 'psql' finns i systemets PATH.
    """
    logger.info(f"Förbereder import av {os.path.basename(geotiff_path)} till {RASTER_TABLE_FULL}...")

    # Kommando för att konvertera raster till SQL.
    # -s: SRID (SWEREF 99 TM)
    # -I: Skapa GIST-index på rasterkolumnen
    # -C: Applicera standard-constraints för raster
    # -t: Dela upp i mindre tiles för prestanda
    # -F: Lägg till filnamnskolumn
    # -d: Ta bort och återskapa tabellen
    raster2pgsql_cmd = [
        'raster2pgsql',
        '-s', '3006',
        '-I', '-C', '-F', '-d',
        '-t', RASTER_TILE_SIZE,
        geotiff_path,
        RASTER_TABLE_FULL
    ]

    # Kommando för att exekvera SQL mot databasen
    psql_cmd = ['psql', db_dsn]

    logger.info("Kör raster2pgsql och piper till psql...")
    try:
        env = os.environ.copy()
        env["PGOPTIONS"] = PGOPTIONS

        # Starta raster2pgsql-processen
        proc_raster = subprocess.Popen(
            raster2pgsql_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
        
        # Starta psql-processen och koppla dess stdin till raster2pgsql's stdout
        proc_psql = subprocess.Popen(
            psql_cmd,
            stdin=proc_raster.stdout,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )

        # Låt raster2pgsql-processen avslutas
        proc_raster.stdout.close()
        raster_stderr = proc_raster.stderr.read().decode('utf-8', errors='ignore')
        
        # Hämta output och fel från psql
        psql_stdout, psql_stderr = proc_psql.communicate()

        if proc_raster.wait() != 0:
            logger.error("Fel uppstod i raster2pgsql.")
            logger.error(raster_stderr)
            return False

        if proc_psql.returncode != 0:
            logger.error("Fel uppstod under psql-exekvering.")
            logger.error(psql_stderr.decode('utf-8', errors='ignore'))
            return False
        
        if not run_psql_sql(db_dsn, f"ANALYZE {RASTER_TABLE_FULL};"):
            return False

        logger.info("Import av rasterdata slutförd.")
        return True

    except FileNotFoundError:
        logger.error("Kommando 'raster2pgsql' eller 'psql' hittades inte. Se till att PostGIS/PostgreSQL bin-mapp finns i systemets PATH.")
        return False
    except Exception as e:
        logger.error(f"Ett oväntat fel uppstod under import: {e}")
        return False

def main():
    logger.info("Startar import av Lantmäteriets Marktäckedata (NMD)...")

    if not ensure_postgis_prerequisites(DB_DSN):
        logger.error("Kunde inte säkerställa PostGIS/schema innan import.")
        sys.exit(1)

    temp_dir = tempfile.mkdtemp(prefix=TEMP_DIR_PREFIX)

    geotiff_file_path = download_and_unzip(DATA_URL, temp_dir)
    
    if not geotiff_file_path:
        shutil.rmtree(temp_dir, ignore_errors=True)
        sys.exit(1)

    import_success = import_raster_to_postgis(DB_DSN, geotiff_file_path)
    
    # Städa upp
    try:
        shutil.rmtree(temp_dir, ignore_errors=True)
    except Exception as e:
        logger.warning(f"Kunde inte städa upp temporär mapp: {e}")

    if import_success:
        logger.info("Processen är klar.")
    else:
        logger.error("Processen misslyckades.")
        sys.exit(1)

if __name__ == "__main__":
    main()
