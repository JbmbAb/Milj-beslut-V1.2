"""
import_nv_vardetrakter.py
Importerar Värdetrakter (Grön Infrastruktur) från D:\\Geo inlärning\\Värdetrakter.zip
till PostGIS env.nv_vardetrakter.
"""
# TODO(Mimers Brunn): Migration debt. This importer still points directly at
# D:\Geo inlärning. Rewrite it to resolve archived input from GEO_Master_Archive.
import os, sys, subprocess, pathlib, zipfile, tempfile, re, urllib.parse

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
OGR = r"C:\Program Files\GDAL\ogr2ogr.exe"
ZIP_PATH = r"D:\Geo inlärning\Värdetrakter.zip"
DB_URL = "postgresql://miljobeslut:miljobeslut@127.0.0.1:5432/miljobeslut"
TABLE_NAME = "env.nv_vardetrakter"

# Parse DB URL for OGR
_pu = urllib.parse.urlparse(DB_URL)
DB_OGR = f"dbname='{_pu.path.lstrip('/')}' host='{_pu.hostname}' user='{_pu.username}' password='{_pu.password}' port='{_pu.port or 5432}'"

def run_sql(query):
    # Run SQL command via psql
    psql_candidates = [
        r"C:\Program Files\QGIS 4.0.2\bin\psql.exe",
        r"C:\Program Files\PostgreSQL\16\bin\psql.exe",
        r"C:\Program Files\PostgreSQL\17\bin\psql.exe",
        r"C:\Program Files\PostgreSQL\15\bin\psql.exe",
        "psql"
    ]
    psql = "psql"
    for p in psql_candidates:
        if os.path.exists(p) or p == "psql":
            psql = p
            if p != "psql":
                break
    cmd = [psql, "-h", "127.0.0.1", "-U", "miljobeslut", "-d", "miljobeslut", "-c", query]
    os.environ["PGPASSWORD"] = "miljobeslut"
    subprocess.run(cmd, capture_output=True)

def main():
    print("=== NV VÄRDETRAKTER IMPORT ===")
    if not os.path.exists(ZIP_PATH):
        print(f"Error: {ZIP_PATH} not found.")
        sys.exit(1)

    # 1. Create schema and table
    run_sql("CREATE SCHEMA IF NOT EXISTS env;")
    run_sql(f"DROP TABLE IF EXISTS {TABLE_NAME};")
    
    # We will let the first ogr2ogr import create the table, but with the added columns.
    # To do this safely, we will write a base schema table.
    schema_query = f"""
    CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
        id SERIAL PRIMARY KEY,
        lan_kod VARCHAR(2),
        tathet_procent INTEGER,
        radie_m INTEGER,
        gridcode INTEGER,
        metod VARCHAR(254),
        beskrivnin VARCHAR(254),
        kontakt VARCHAR(200),
        aktualitet VARCHAR(30),
        eunis VARCHAR(65),
        tema VARCHAR(100),
        geom geometry(MultiPolygon, 3006)
    );
    """
    run_sql(schema_query)
    print("  Created target table env.nv_vardetrakter")

    # 2. Extract shapefiles
    with tempfile.TemporaryDirectory() as tmpdir:
        print(f"  Extracting shapefiles to temp directory...")
        with zipfile.ZipFile(ZIP_PATH) as z:
            # We filter for shapefiles and associated metadata files (.shp, .shx, .dbf, .prj)
            shp_files = [n for n in z.namelist() if n.endswith('.shp')]
            for shp_name in shp_files:
                base = shp_name.rsplit('.', 1)[0]
                for ext in ['.shp', '.shx', '.dbf', '.prj']:
                    try:
                        z.extract(base + ext, tmpdir)
                    except KeyError:
                        pass # some extensions might not exist

        # 3. Import each shapefile
        tmp_path = pathlib.Path(tmpdir)
        # Search recursively for .shp files in the extracted folder
        shps = list(tmp_path.glob("**/*.shp"))
        print(f"  Found {len(shps)} shapefiles to process.")

        for idx, shp in enumerate(shps, 1):
            shp_name = shp.name # e.g. l20fs500trakt.shp
            # Parse parameters from name and path
            # Path looks like: Täthet 5/Focal Statistics 500 meter/
            rel_path = shp.relative_to(tmp_path)
            path_str = str(rel_path)

            # tathet_procent (5 or 10)
            tathet_match = re.search(r"T.thet\s+(\d+)", path_str, re.IGNORECASE)
            tathet = int(tathet_match.group(1)) if tathet_match else 5

            # radie_m (500, 1000, 3000)
            radie_match = re.search(r"Statistics\s+(\d+)", path_str, re.IGNORECASE)
            radie = int(radie_match.group(1)) if radie_match else 500

            # lan_kod (e.g. l20 -> 20, l1 -> 01)
            lan_match = re.search(r"^l(\d+)", shp_name, re.IGNORECASE)
            if lan_match:
                lan_num = int(lan_match.group(1))
                lan_kod = f"{lan_num:02d}"
            else:
                lan_kod = "00"

            # Layer name is the shapefile basename
            layer_name = shp.stem

            print(f"  [{idx}/{len(shps)}] Importing {shp_name} (Län: {lan_kod}, Täthet: {tathet}%, Radie: {radie}m)...")

            # We use OGR SQL to select with constant columns
            sql = f"SELECT '{lan_kod}' AS lan_kod, {tathet} AS tathet_procent, {radie} AS radie_m, GRIDCODE, METOD, BESKRIVNIN, KONTAKT, AKTUALITET, EUNIS, TEMA FROM {layer_name}"

            cmd = [
                OGR, "-f", "PostgreSQL", f"PG:{DB_OGR}",
                str(shp),
                "-nln", TABLE_NAME,
                "-append",
                "-sql", sql,
                "-nlt", "PROMOTE_TO_MULTI",
                "-lco", "GEOMETRY_NAME=geom",
                "-gt", "65536",
                "--config", "PG_USE_COPY", "YES"
            ]

            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode != 0:
                print(f"    [ERROR] Failed to import {shp_name}: {res.stderr[:200]}")

    # 4. Post-import optimizations
    print("  Creating GiST spatial index...")
    run_sql(f"CREATE INDEX IF NOT EXISTS nv_vardetrakter_geom_gist ON {TABLE_NAME} USING GIST (geom);")
    print("  Running VACUUM ANALYZE...")
    run_sql(f"VACUUM ANALYZE {TABLE_NAME};")
    
    # Show counts
    print("=== IMPORT COMPLETE ===")
    run_sql(f"SELECT COUNT(*) FROM {TABLE_NAME};")

if __name__ == "__main__":
    main()
