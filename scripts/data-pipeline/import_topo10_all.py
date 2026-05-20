import os, subprocess

# Konfiguration
UTTAG_DIR = r"C:\Users\jimmy\Desktop\MiljoBeslut_Produktdata\Kartor\Topografisk webbkarta - uttag f9c36525"
DB_CONN = "PG:host=host.docker.internal port=5432 user=miljobeslut password=password dbname=miljobeslut"
# Orsa Bbox
BBOX = "14.3 60.9 15.0 61.4"

LAYERS_TO_IMPORT = [
    {"file": "mark_sverige/mark_sverige.gpkg", "layer": "mark", "table": "topo10.mark"},
    {"file": "kommunikation_sverige/kommunikation_sverige.gpkg", "layer": "vaglinje", "table": "topo10.vag"},
    {"file": "hydrografi_sverige/hydrografi_sverige.gpkg", "layer": "hydrolinje", "table": "topo10.vatten"},
    {"file": "kommunikation_sverige/kommunikation_sverige.gpkg", "layer": "ralstrafik", "table": "topo10.jarnvag"},
    {"file": "anlaggningsomrade_sverige/anlaggningsomrade_sverige.gpkg", "layer": "anlaggningsomrade", "table": "topo10.anlaggning"},
]

def run_import(cfg):
    src_path = os.path.join(UTTAG_DIR, cfg["file"])
    folder = os.path.dirname(src_path)
    filename = os.path.basename(src_path)
    
    cmd = [
        "docker", "run", "--rm",
        "-v", f"{folder}:/data",
        "ghcr.io/osgeo/gdal:ubuntu-small-latest",
        "ogr2ogr", "-f", "PostgreSQL", DB_CONN,
        f"/data/{filename}",
        cfg["layer"],
        "-nln", cfg["table"],
        "-t_srs", "EPSG:4326",
        "-s_srs", "EPSG:3006",
        "-clipsrc", *BBOX.split(),
        "-lco", "GEOMETRY_NAME=geom",
        "-overwrite"
    ]
    
    print(f"Importerar {cfg['layer']} till {cfg['table']}...")
    try:
        subprocess.run(cmd, check=True)
        print(f"  [KLART] {cfg['table']}")
    except subprocess.CalledProcessError as e:
        print(f"  [FEL] Misslyckades med {cfg['layer']}: {e}")

if __name__ == "__main__":
    for cfg in LAYERS_TO_IMPORT:
        run_import(cfg)
