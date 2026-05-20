"""
import_all_datasets.py
Universellt importskript for alla extraherade geodataset.
Anvander ogr2ogr (GDAL) for GeoPackage/Shapefile -> PostGIS.
Kors med: python import_all_datasets.py [kategori]
Kategorier: nvr | sgu | msb | vatten | natura2000 | nmd | vatmark |
            skog | geofysik | smhi | kulturmiljo | buller | alla
"""
import os, sys, subprocess, pathlib, json, shutil, re
from datetime import datetime

try:
    import psycopg2
except ImportError:
    psycopg2 = None

EXTRACTED    = r'D:\ingest-arkiv-2026-03-29\dataportal-env\downloads\files'
LOG          = r'C:\Dev\miljobeslut-platform-recovery\logs\import.log'
GDAL_IMAGE   = 'ghcr.io/osgeo/gdal:ubuntu-small-latest'
EXTRACTED_LX = '/data/extracted'   # Monterings-path inuti Docker
_TABLES_INITIALIZED = set()

# Haemta DATABASE_URL fran .env.local/.env
PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
PROJECT_DATA_ROOT = PROJECT_ROOT.parent
RAW_SOURCE_ROOTS = [
    pathlib.Path(EXTRACTED),
    pathlib.Path(r'D:\ingest-arkiv-2026-03-29\nvr-download'),
    PROJECT_ROOT / 'scratch' / 'naturvardsverket' / 'natura2000_sci',
    PROJECT_ROOT / 'scratch' / 'naturvardsverket' / 'natura2000_spa',
    PROJECT_DATA_ROOT / 'Miljobeslut_Ops_Pipeline' / 'storage' / 'extracted',
    pathlib.Path(r'D:\MiljoBeslut_Produktdata_Sources\Pipeline_Storage\storage\extracted'),
    pathlib.Path(r'D:\MiljoBeslut_Produktdata_Sources\Geodata'),
]
DATASET_ALIASES = {
    'GPT_potentella_lovskogar': ['potentiella_lovskogar'],
    'naturtypskartan_RIKS': ['Naturtypskartan_RIKS'],
    'NMD2023_basskikt': ['NMD2023_basskikt_v2_1'],
    'vatmark_nationell_t01t02_fklass.20210319': ['vatmark_nationell_t01t02_fklass'],
    'vatmark_nationell_t01t02_fkartor.20210319': ['vatmark_nationell_t01t02_fkartor'],
    'RI_Naturvard': ['RIKSINTRESSE_NATURVARD', 'extracted_nv_riksintresse_natur'],
    'RI_Friluftsliv': ['friluftsliv'],
    'HH.StrategicNoiseMaps_Sweden_END_Geopackage': ['ljudmiljo'],
}
DATASET_HINTS = {
    'RI_Naturvard': [
        pathlib.Path(r'D:\MiljoBeslut_Produktdata_Sources\Geodata\Naturvardsverket\extracted_nv_riksintresse_natur'),
    ],
    'naturtypskartan_RIKS': [
        pathlib.Path(r'D:\MiljoBeslut_Produktdata_Sources\Geodata\Naturvardsverket\naturtypskartan\extracted\Naturtypskartan_RIKS'),
    ],
    'NMD2023_basskikt': [
        pathlib.Path(r'D:\MiljoBeslut_Produktdata_Sources\Geodata\Naturvardsverket\nmd2023\extracted\NMD2023_basskikt_v2_1'),
    ],
    'vatmark_nationell_t01t02_fklass.20210319': [
        pathlib.Path(r'D:\MiljoBeslut_Produktdata_Sources\Geodata\Naturvardsverket\vatmark_nationell\extracted\vatmark_nationell_t01t02_fklass'),
    ],
    'HH.StrategicNoiseMaps_Sweden_END_Geopackage': [
        pathlib.Path(r'D:\MiljoBeslut_Produktdata_Sources\Geodata\MiljoBeslut_Archive\reimported-from-c\production-imported-2026-05-02\storage\extracted\HH.StrategicNoiseMaps_Sweden_END_Geopackage'),
    ],
}
ENV_FILES = [
    PROJECT_ROOT / '.env.local',
    PROJECT_ROOT / '.env',
]
DB_URL    = os.environ.get('DATABASE_URL', '')
if not DB_URL:
    for env_file in ENV_FILES:
        if not os.path.exists(env_file):
            continue
        for line in open(env_file, encoding='utf-8'):
            if line.startswith('DATABASE_URL='):
                DB_URL = line.split('=', 1)[1].strip().strip('"').strip("'")
                break
        if DB_URL:
            break
if not DB_URL:
    print('[FEL] Ingen DATABASE_URL. Saett env-variabeln eller laaegg till .env')
    sys.exit(1)
# Docker service hostnames (db, postgres) are unreachable from Windows host
# localhost resolves to ::1 (IPv6) on Windows — force IPv4
DB_URL = (DB_URL
    .replace('@db:', '@127.0.0.1:')
    .replace('@postgres:', '@127.0.0.1:')
    .replace('@localhost:', '@127.0.0.1:'))
# Convert postgresql:// URL to GDAL key-value format (Windows ogr2ogr fails with URL format)
import urllib.parse as _urlparse
_pu = _urlparse.urlparse(DB_URL)
DB_OGR = f"dbname='{_pu.path.lstrip('/')}' host='{_pu.hostname}' user='{_pu.username}' password='{_pu.password}' port='{_pu.port or 5432}'"

# Identifiera om ogr2ogr finns lokalt eller om Docker behoevs
_OGR2OGR_PATH = shutil.which('ogr2ogr')
if not _OGR2OGR_PATH:
    # Kolla vanliga Windows-sokvagar
    _common_paths = [
        r'C:\Program Files\GDAL\ogr2ogr.exe',
        r'C:\OSGeo4W\bin\ogr2ogr.exe',
        r'C:\Program Files\QGIS 3.34\bin\ogr2ogr.exe',
    ]
    for p in _common_paths:
        if os.path.exists(p):
            _OGR2OGR_PATH = p
            break

_OGR2OGR_LOCAL = _OGR2OGR_PATH is not None
_OGRINFO_PATH = None
if _OGR2OGR_PATH:
    _candidate = os.path.join(os.path.dirname(_OGR2OGR_PATH), 'ogrinfo.exe' if os.name == 'nt' else 'ogrinfo')
    if os.path.exists(_candidate):
        _OGRINFO_PATH = _candidate
_TABLE_EXISTS_CACHE = {}

def _build_local_gdal_env():
    env = os.environ.copy()
    # PostgreSQL/PostGIS often sets GDAL/PROJ vars that break standalone GDAL tools.
    env.pop('GDAL_DRIVER_PATH', None)
    if not _OGR2OGR_PATH:
        return env
    bin_dir = pathlib.Path(_OGR2OGR_PATH).parent
    proj_candidates = [
        bin_dir / 'projlib',
        bin_dir.parent / 'share' / 'proj',
    ]
    gdal_data_candidates = [
        bin_dir / 'gdal-data',
        bin_dir.parent / 'share' / 'gdal',
    ]
    for candidate in proj_candidates:
        if candidate.exists():
            env['PROJ_LIB'] = str(candidate)
            break
    for candidate in gdal_data_candidates:
        if candidate.exists():
            env['GDAL_DATA'] = str(candidate)
            break
    return env

_LOCAL_GDAL_ENV = _build_local_gdal_env()

def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line)
    pathlib.Path(LOG).parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')

def _db_connect():
    if psycopg2 is None:
        return None
    return psycopg2.connect(DB_URL)

def _quote_ident(value):
    return '"' + value.replace('"', '""') + '"'

def table_exists(schema, table):
    key = (schema, table)
    if key in _TABLE_EXISTS_CACHE:
        return _TABLE_EXISTS_CACHE[key]
    conn = None
    try:
        conn = _db_connect()
        if conn is None:
            _TABLE_EXISTS_CACHE[key] = False
            return False
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT EXISTS (
                  SELECT 1
                  FROM information_schema.tables
                  WHERE table_schema = %s AND table_name = %s
                )
                """,
                (schema, table),
            )
            exists = bool(cur.fetchone()[0])
            _TABLE_EXISTS_CACHE[key] = exists
            return exists
    except Exception as exc:
        log(f'  [WARN] Kunde inte kontrollera tabell {schema}.{table}: {exc}')
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass

def table_row_count(schema, table):
    if not table_exists(schema, table):
        return 0
    conn = None
    try:
        conn = _db_connect()
        if conn is None:
            return 0
        sql = f'SELECT count(*) FROM {_quote_ident(schema)}.{_quote_ident(table)}'
        with conn, conn.cursor() as cur:
            cur.execute(sql)
            return int(cur.fetchone()[0])
    except Exception as exc:
        log(f'  [WARN] Kunde inte raekna rader i {schema}.{table}: {exc}')
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass

def run_sql(sql):
    conn = None
    try:
        conn = _db_connect()
        if conn is None:
            log('  [WARN] psycopg2 saknas; kan inte koera SQL-bootstrap')
            return False
        with conn:
            with conn.cursor() as cur:
                cur.execute(sql)
        _TABLE_EXISTS_CACHE.clear()
        return True
    except Exception as exc:
        log(f'  FEL vid SQL-bootstrap: {exc}')
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass

def _safe_table_suffix(value):
    value = value.lower().replace('-', '_')
    value = re.sub(r'[^a-z0-9_]+', '_', value)
    value = re.sub(r'_+', '_', value).strip('_')
    return value[:42] or 'layer'

def _list_ogr_layers(src_path):
    if not _OGRINFO_PATH:
        return []
    result = subprocess.run([_OGRINFO_PATH, '-ro', '-so', str(src_path)], capture_output=True, text=True, env=_LOCAL_GDAL_ENV)
    if result.returncode != 0 and not re.search(r'^\s*\d+:\s+', result.stdout, re.MULTILINE):
        log(f'  [WARN] Kunde inte lista lager i {pathlib.Path(src_path).name}: {result.stderr[:200]}')
        return []
    layers = []
    for line in result.stdout.splitlines():
        match = re.match(r'\s*\d+:\s+([^\s(]+)\s+\(([^)]+)\)', line)
        if match:
            layers.append((match.group(1), match.group(2)))
    return layers

def _get_source_layer_name(src_path):
    src_path = pathlib.Path(src_path)
    if src_path.suffix.lower() == '.shp':
        return src_path.stem
    layers = _list_ogr_layers(src_path)
    if layers:
        return layers[0][0]
    return src_path.stem

def _get_layer_field_names(src_path, source_layer=None):
    if not _OGRINFO_PATH:
        return {}
    cmd = [_OGRINFO_PATH, '-ro', '-so', str(src_path)]
    if source_layer:
        cmd.append(source_layer)
    result = subprocess.run(cmd, capture_output=True, text=True, env=_LOCAL_GDAL_ENV)
    if result.returncode != 0:
        log(f'  [WARN] Kunde inte lista faelt i {pathlib.Path(src_path).name}: {result.stderr[:200]}')
        return {}
    fields = {}
    for line in result.stdout.splitlines():
        match = re.match(r'^\s*([^:=][^:]+):\s+[A-Za-z]', line)
        if not match:
            continue
        field_name = match.group(1).strip()
        if field_name in {'Layer name', 'Geometry', 'Feature Count', 'Layer SRS WKT', 'Geometry Column', 'FID Column'}:
            continue
        fields[field_name.lower()] = field_name
    return fields

def resolve_dataset_folder(folder_name):
    candidates = [folder_name] + DATASET_ALIASES.get(folder_name, [])
    checked = set()
    for candidate in candidates:
        direct = pathlib.Path(EXTRACTED) / candidate
        if direct.exists():
            return direct
        for root in RAW_SOURCE_ROOTS:
            possible = root / candidate
            if possible.exists():
                return possible
    for hint in DATASET_HINTS.get(folder_name, []):
        if hint.exists():
            return hint
    for root in RAW_SOURCE_ROOTS:
        if not root.exists():
            continue
        try:
            for path in root.rglob('*'):
                lower_name = path.name.lower()
                if path in checked:
                    continue
                checked.add(path)
                if any(lower_name == candidate.lower() for candidate in candidates):
                    return path
        except OSError:
            continue
    return None

def _build_ogr_args(src_path, schema, table, src_srs, target_srs, mode, extra_opts, source_layer=None):
    """Returnerar ogr2ogr-argumentlistan (utan sjaelva 'ogr2ogr'-kommandot)."""
    args = [
        '-f', 'PostgreSQL',
        f'PG:{DB_OGR}',
        str(src_path),
    ]
    if source_layer:
        args.append(source_layer)
    args.extend([
        '-nln', f'{schema}.{table}',
        '-t_srs', target_srs,
        '-s_srs', src_srs,
        '-dim', 'XY',
        mode,
        '--config', 'PG_USE_COPY', 'YES',
        '-progress',
    ])
    if extra_opts:
        args.extend(extra_opts)
    return args

def ogr_import(src_path, schema, table, src_srs='EPSG:3006', target_srs='EPSG:3006',
               extra_opts=None, mode=None, source_layer=None):
    """Kors ogr2ogr. Om mode ej anges bestams den av _TABLES_INITIALIZED state."""
    global _TABLES_INITIALIZED
    src_path = pathlib.Path(src_path)
    full_table = f"{schema}.{table}"
    
    if mode is None:
        # Kolla om tabellen redan finns i DB for att undvika overwrite vid resume.
        # Anvaend psycopg2 i staellet for psql eftersom psql ofta saknas i PATH pa Windows.
        exists = table_exists(schema, table)

        if exists or full_table in _TABLES_INITIALIZED:
            mode = '-append'
        else:
            mode = '-overwrite'
            _TABLES_INITIALIZED.add(full_table)
            
    layer_note = f' lager {source_layer}' if source_layer else ''
    log(f'ogr2ogr ({mode}) -> {full_table} fran {src_path.name}{layer_note}')

    if _OGR2OGR_LOCAL:
        # Lokalt ogr2ogr finns — kors direkt
        cmd = [_OGR2OGR_PATH] + _build_ogr_args(str(src_path), schema, table,
                                             src_srs, target_srs, mode, extra_opts, source_layer)
        result = subprocess.run(cmd, capture_output=True, text=True, env=_LOCAL_GDAL_ENV)
    else:
        # Kors via Docker — montera EXTRACTED-mappen som read-only
        # Bygg om src_path till Linux-path inuti containern
        try:
            rel = src_path.relative_to(EXTRACTED)
            src_lx = f'{EXTRACTED_LX}/{rel.as_posix()}'
        except ValueError:
            log(f'  FEL: Filen ligger utanfor EXTRACTED-mappen: {src_path}')
            return False

        ogr_args = _build_ogr_args(src_lx, schema, table,
                                   src_srs, target_srs, mode, extra_opts, source_layer)
        # Byt ut host-path i DB_URL: host.docker.internal nar DB kor lokalt pa Windows
        # _build_ogr_args returnerar: ['-f', 'PostgreSQL', 'PG:...', src_path, ...]
        # => PG:... ligger pa index 2
        db_url_docker = (DB_URL
                         .replace('@localhost:', '@host.docker.internal:')
                         .replace('@127.0.0.1:', '@host.docker.internal:'))
        ogr_args[2] = f'PG:{db_url_docker}'   # ersaett PG:... med Docker-anpassad URL

        cmd = [
            'docker', 'run', '--rm',
            '--add-host=host.docker.internal:host-gateway',
            '-v', f'{EXTRACTED}:{EXTRACTED_LX}:ro',
            GDAL_IMAGE,
            'ogr2ogr',
        ] + ogr_args
        result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        log(f'  FEL: {result.stderr[:300]}')
        return False
    log('  OK')
    _TABLE_EXISTS_CACHE[(schema, table)] = True
    return True

def find_geodata(folder):
    """Returnerar lista av geodatafiler i en mapp (gpkg, shp, gml, geojson, gdb)."""
    p = pathlib.Path(folder)
    files = []
    for ext in ('*.gpkg', '*.shp', '*.gml', '*.geojson'):
        files.extend(p.rglob(ext))
    files.extend(path for path in p.rglob('*.gdb') if path.is_dir())
    return sorted(set(files))

# =================================================================
# IMPORTRUTINER PER KATEGORI
# =================================================================

def import_nvr():
    """P1: NVR Naturvardsregistret -> env.protected_area / env.water_protection_area"""
    log('\n=== NVR Naturvardsregistret ===')

    def _nvr_sql(stem, ptype, id_col='NVRID', status_col='BESLSTATUS',
                 name_col='NAMN', auth_col='BESLMYND',
                 from_col='IKRAFTDATF', to_col='SENGALLDAT', area_col='AREA_HA'):
        return (
            f"SELECT {id_col} AS nvr_id, {status_col} AS decision_status, "
            f"{name_col} AS name, '{ptype}' AS protection_type, "
            f"{auth_col} AS decision_authority, "
            f"{from_col} AS valid_from, {to_col} AS valid_to, "
            f"{area_col} AS area_ha "
            f'FROM "{stem}"'
        )

    # Standardformat: NVRID, BESLSTATUS, NAMN, BESLMYND, IKRAFTDATF, SENGALLDAT, AREA_HA
    nvr_standard = {
        'NP':   'Nationalpark',
        'NR':   'Naturreservat',
        'NVO':  'Naturvardsomrade',
        'DVO':  'Djur-vaxt-skydd',
        'NM':   'Naturminne',
        'KR':   'Kulturreservat',
        'OBO':  'Biotopskydd',
        'LBSO': 'Landskapsbildsskydd',
        'IF':   'Interimistiskt forbud',
    }
    for folder_name, ptype in nvr_standard.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        for gf in find_geodata(folder):
            # Skippa punkter for den polygon-basserade tabellen protected_area
            if 'point' in gf.name.lower():
                log(f'  [SKIP] {gf.name} (punkt-geometri i polygon-tabell)')
                continue
                
            ogr_import(gf, 'env', 'protected_area',
                       extra_opts=['-sql', _nvr_sql(gf.stem, ptype),
                                   '-nlt', 'PROMOTE_TO_MULTI'])

    # NVA: ID->nvr_id, STATUS->decision_status, OBJNAMN->name, DATSTART/DATSLUT->valid_*
    nva_folder = resolve_dataset_folder('NVA')
    if nva_folder:
        for gf in find_geodata(nva_folder):
            sql = _nvr_sql(gf.stem, 'Naturvardsavtal',
                           id_col='ID', status_col='STATUS',
                           name_col='OBJNAMN', auth_col="''",
                           from_col='DATSTART', to_col='DATSLUT', area_col='SHAPE_AREA')
            ogr_import(gf, 'env', 'protected_area',
                       extra_opts=['-sql', sql, '-nlt', 'PROMOTE_TO_MULTI'])
    else:
        log('  [SAKNAS] NVA')

    # TILLTRADESFORBUD: NVRID, BESLSTAT (inte BESLSTATUS)
    tf_folder = resolve_dataset_folder('TILLTRADESFORBUD')
    if tf_folder:
        for gf in find_geodata(tf_folder):
            sql = _nvr_sql(gf.stem, 'Tilltradesforbud',
                           status_col='BESLSTAT',
                           name_col='OBJEKTNAMN', auth_col="''",
                           from_col='FRANDATUM', to_col='TILLDATUM')
            ogr_import(gf, 'env', 'protected_area',
                       extra_opts=['-sql', sql, '-nlt', 'PROMOTE_TO_MULTI'])
    else:
        log('  [SAKNAS] TILLTRADESFORBUD')

    # VSO -> water_protection_area (eget schema utan nvr_id-krav)
    vso_folder = resolve_dataset_folder('VSO')
    if vso_folder:
        for gf in find_geodata(vso_folder):
            ogr_import(gf, 'env', 'water_protection_area',
                       extra_opts=['-nlt', 'PROMOTE_TO_MULTI'])
    else:
        log('  [SAKNAS] VSO')


def import_sgu():
    """P2: SGU geologiska dataset -> env.sgu_* tabeller"""
    log('\n=== SGU Geologiska dataset ===')
    # SGU geopackage-filer har ofta maanga lager (punkter, linjer, ytor).
    # Vi fokuserar pa ytor (MultiPolygon) for soil_type och permeability.
    sgu_map = {
        'jordarter25k-100k':        ('env', 'sgu_soil_type'),
        'jordarter250k':            ('env', 'sgu_soil_type'),
        'jordarter200k':            ('env', 'sgu_soil_type'),
        'jordarter750k':            ('env', 'sgu_soil_type'),
        'jordarter1miljon':         ('env', 'sgu_soil_type'),
        'jorddjupsmodell':          ('env', 'sgu_soil_depth'),
        'genomslapplighet':         ('env', 'sgu_permeability'),
        'fastmark':                 ('env', 'sgu_soil_type'),
        'sur-sulfatjord':           ('env', 'sgu_soil_type'),
        'berggrund50k-250k':        ('env', 'sgu_bedrock'),
        'berggrund1miljon':         ('env', 'sgu_bedrock'),
        'grus-krossberg':           ('env', 'sgu_bedrock'),
    }

    # Flera av dessa mappar ar tunga och har redan importerats i lokal DB.
    # Default ar darfor att inte appenda till en redan fylld target-tabell.
    # Saett SGU_IMPORT_APPEND_EXISTING=1 om du uttryckligen vill appenda igen.
    skip_existing = os.environ.get('SGU_IMPORT_APPEND_EXISTING', '0') != '1'

    well_map = {
        'grundvattentillgang-sma-magasin': ('sgu_well', None),
        'grundvattennivaer-observerade':   ('sgu_well', None),
        'kallor':                          ('sgu_well', None),
        'brunnar':                         ('sgu_well_actual', None),
    }

    # Helper for robust import
    def _import_sgu_category(mapping):
        for folder_name, target in mapping.items():
            folder = resolve_dataset_folder(folder_name)
            if not folder:
                log(f'  [SAKNAS] {folder_name}')
                continue
            if isinstance(target, tuple):
                table, source_layer = target
            else:
                table, source_layer = target, None
            schema = 'env'
            if skip_existing and table_row_count(schema, table) > 0:
                log(f'  [SKIP] {folder_name} -> {schema}.{table} har redan data (SGU_IMPORT_APPEND_EXISTING=1 for append)')
                continue
            for gf in find_geodata(folder):
                # Robust hantering: om tabellen foervaentar ytor (soil_type), skippa punkt-filer
                if table in ('sgu_soil_type', 'sgu_permeability', 'sgu_bedrock') and 'point' in gf.name.lower():
                    log(f'  [SKIP] {gf.name} (punkt-geometri i ytbasserad tabell {table})')
                    continue
                if table == 'sgu_well' and ('line' in gf.name.lower() or 'polygon' in gf.name.lower()):
                    log(f'  [SKIP] {gf.name} (yta/linje i punkt-tabell sgu_well)')
                    continue

                # Anvaend -skipfailures och PROMOTE_TO_MULTI. Tvinga -append foer att inte rensa tabellen
                opts = ['-nlt', 'PROMOTE_TO_MULTI', '-skipfailures']
                ogr_import(gf, schema, table, extra_opts=opts, mode='-append', source_layer=source_layer)

    def _import_if_empty(folder_name, table, source_layer=None, extra_opts=None):
        if skip_existing and table_row_count('env', table) > 0:
            log(f'  [SKIP] {folder_name} -> env.{table} har redan data')
            return
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            return
        for gf in find_geodata(folder):
            ogr_import(
                gf,
                'env',
                table,
                extra_opts=extra_opts or ['-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'],
                mode='-append',
                source_layer=source_layer,
            )

    def _import_landslide_features():
        if skip_existing and table_row_count('env', 'sgu_landslide_feature') > 0:
            log('  [SKIP] jordskred-raviner -> env.sgu_landslide_feature har redan data')
            return
        folder = resolve_dataset_folder('jordskred-raviner')
        if not folder:
            log('  [SAKNAS] jordskred-raviner')
            return
        sql = (
            "SELECT "
            "'jordskred-raviner.' || CAST(objectid AS TEXT) AS source_key, "
            "CAST(objectid AS INTEGER) AS source_object_id, "
            "CAST(sl AS INTEGER) AS feature_code, "
            "sl_tx AS feature_label, "
            "CAST(symbol AS INTEGER) AS symbol, "
            "CAST(geom_length AS FLOAT) AS length_m "
            "FROM jordskred_raviner"
        )
        for gf in find_geodata(folder):
            ogr_import(
                gf,
                'env',
                'sgu_landslide_feature',
                extra_opts=['-sql', sql, '-dialect', 'SQLite', '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'],
                mode='-append',
            )
            # Inventeringsytan ar en metadata-yta, inte en skredlinje.
            ogr_import(
                gf,
                'env',
                'sgu_landslide_inventory_area',
                extra_opts=['-nlt', 'PROMOTE_TO_MULTI', '-lco', 'GEOMETRY_NAME=geom'],
                mode='-overwrite',
                source_layer='inventerat_omrade',
            )

    def _import_layers_to_own_tables(folder_name, table_prefix):
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            return
        for gf in find_geodata(folder):
            layers = _list_ogr_layers(gf)
            if not layers:
                log(f'  [WARN] Inga lager hittades i {gf.name}')
                continue
            for layer_name, geometry_type in layers:
                table = f'{table_prefix}_{_safe_table_suffix(layer_name)}'[:63]
                log(f'  [LAGER] {folder_name}:{layer_name} ({geometry_type}) -> env.{table}')
                ogr_import(
                    gf,
                    'env',
                    table,
                    extra_opts=['-nlt', 'PROMOTE_TO_MULTI', '-lco', 'GEOMETRY_NAME=geom'],
                    mode='-overwrite',
                    source_layer=layer_name,
                )

    # _import_sgu_category(sgu_map) # Redan klart
    _import_if_empty('grundvattenmagasin', 'sgu_groundwater_magazine', source_layer='grundvattenmagasin')
    _import_if_empty('grundvattenforekomster', 'sgu_groundwater_body', source_layer='grundvattenforekomster')
    _import_landslide_features()
    _import_sgu_category(well_map)

    # Blandade punkt/linje/polygon-lager ska inte appenda till polygonlagret sgu_permeability.
    # De laeggs i egna tabeller sa att allt kommer in utan geometri-mismatch.
    _import_layers_to_own_tables('stranderosion-kust', 'sgu_coastal_erosion')
    _import_layers_to_own_tables('hogsta-kustlinjen', 'sgu_highest_coastline')

def import_msb():
    """P2: MSB oversvamning/risk -> climate.flood_risk_area, climate.risk_area"""
    log('\n=== MSB Oversvamning och risk ===')
    # MSB data har ofta blandade geometrier
    msb_map = {
        'InspireMSB_oversvam':  ('climate', 'flood_risk_area'),
        'InspireMSB_APSFR':     ('climate', 'flood_risk_area'),
        'InspireMSB_pfra':      ('climate', 'flood_risk_area'),
        'InspireMSB_storaolyckor': ('climate', 'risk_area'),
        'seveso':               ('env',     'risk_area'),
        'brandstationer':       ('env',     'risk_area'),
    }
    for folder_name, (schema, table) in msb_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        for gf in find_geodata(folder):
            # Saekerstaell external_id (not null) via SQL (OGR-kompatibel CAST)
            sql = f'SELECT *, CAST(fid AS character) AS external_id FROM "{gf.stem}"'
            ogr_import(gf, schema, table, extra_opts=['-sql', sql, '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'])

def import_vatten():
    """P2: Avrinning, grundvatten -> env.water_catchment, env.water_station"""
    log('\n=== SMHI Vatten och avrinning ===')
    v_map = {
        'SVAR2022_delavrinningsomraden':             ('env', 'water_catchment'),
        'SVAR2022_Vattenforekomstavrinningsomraden': ('env', 'water_catchment'),
        'Avrinningsomraden_2016':                    ('env', 'water_catchment'),
        'klimatindikatorer-sgu-hype-omraden':        ('env', 'sgu_well'),
        'SE_EF_StnReg_DV_Sjoar_vattendrag':          ('env', 'water_station'),
        'SE_EF_StnReg_DV_Grundvatten':               ('env', 'sgu_well'),
    }
    for folder_name, (schema, table) in v_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        for gf in find_geodata(folder):
            ogr_import(gf, schema, table, extra_opts=['-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'])

def import_natura2000():
    """P2: Natura 2000, Ramsar, Varldsarv -> env.natura2000_area, env.protected_area"""
    log('\n=== Natura 2000 och internationellt skydd ===')
    shape_encoding_opts = ['--config', 'SHAPE_ENCODING', 'ISO-8859-1']

    # 1. Natura 2000 (SCI / SPA)
    # external_id (NOT NULL) <- SITE_CODE
    # site_name              <- NAMN
    for cat in ['SCI_Rikstackande', 'SPA_Rikstackande']:
        folder = resolve_dataset_folder(cat)
        if folder:
            for gf in find_geodata(folder):
                sql = f'SELECT SITE_CODE AS external_id, NAMN AS site_name, SITE_CODE AS site_code, OMRADESTYP AS category FROM "{gf.stem}"'
                ogr_import(gf, 'env', 'natura2000_area',
                           extra_opts=shape_encoding_opts + ['-sql', sql, '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'])
        else:
            log(f'  [SAKNAS] {cat}')

    # 2. Internationellt skydd -> env.protected_area
    #protected_area har nvr_id (NOT NULL) och decision_status (NOT NULL)
    int_map = {
        'Ramsar_2018':      'RAMSAR',
        'Varldsarv':        'Varldsarv',
        'biosfarsomraden':  'Biosfarsomraade',
        'Nationalparksplan': 'Nationalparksplan',
        'Skyddsvarda_statliga_skogar': 'Statlig skog',
    }
    for folder_name, ptype in int_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            continue
        for gf in find_geodata(folder):
            # Prova hitta ett ID, annars generera ett fran namn
            id_field = 'RAMSAR_ID' if 'Ramsar' in folder_name else 'NAMN'
            # Vi saetter decision_status till 'Gaellande' default
            sql = (
                f"SELECT {id_field} AS nvr_id, 'Gaellande' AS decision_status, "
                f"NAMN AS name, '{ptype}' AS protection_type "
                f'FROM "{gf.stem}"'
            )
            ogr_import(gf, 'env', 'protected_area',
                       extra_opts=shape_encoding_opts + ['-sql', sql, '-nlt', 'PROMOTE_TO_MULTI'],
                       mode='-append')

    # 3. OECM / Habitat
    oecm_folder = resolve_dataset_folder('oecm_2024')
    if oecm_folder:
        for gf in find_geodata(oecm_folder):
            # Exkludera fältet 'shape_area' från SELECT * för att undvika att skriva till numeric(18,11)
            # Vi mappar det istället till shape_area_f (float)
            sql = f'SELECT LOCALID, LEGFDATE, SITENAME, DESTYP, CAST(Shape_Area AS float) AS shape_area_f FROM "{gf.stem}"'
            ogr_import(gf, 'env', 'habitat_type',
                       extra_opts=['-sql', sql, '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'])

def import_nmd():
    """NMD Marktaecke, Markanvaendning -> env.land_cover"""
    log('\n=== NMD Marktaecke och Markanvaendning ===')
    nmd_map = {
        'NMD2023_Tillaggsskikt_Markanvandning_v1_0': 'NMD2023_markanvandning',
        'NMD_Tillaggsskikt_Markanvandning':          'NMD_aeldre_markanvaendning',
        'NMD2023_basskikt':                          'NMD2023_basskikt_v2_1',
    }
    for folder_name, source_label in nmd_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        for gf in find_geodata(folder):
            # Vi vaeljer ut standardfaelt och skippar system-specifika shape-areor som ofta failar
            sql = f"SELECT *, '{source_label}' AS source FROM \"{gf.stem}\""
            ogr_import(gf, 'env', 'land_cover',
                       extra_opts=['-sql', sql,
                                   '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'])

def import_soil_moisture():
    """NMD Markfuktighetsindex -> env.soil_moisture"""
    log('\n=== NMD Markfuktighetsindex ===')
    for i in list(range(1, 10)) + ['Sverige']:
        folder = resolve_dataset_folder(f'Markfuktighetsindex_NMD_del{i}')
        if i == 'Sverige':
            folder = resolve_dataset_folder('Markfuktighetsindex_NMD_Sverige')
        if not folder:
            log(f'  [SAKNAS] del{i}')
            continue
        for gf in find_geodata(folder):
            ogr_import(gf, 'env', 'soil_moisture',
                       extra_opts=['-sql', f"SELECT *, 'del{i}' AS source_part FROM \"{gf.stem}\"",
                                   '-nlt', 'PROMOTE_TO_MULTI'],
                       mode='-append') # Anvaend append har pga delvis import

def import_vatmark():
    """Vaetmark -> env.wetland"""
    log('\n=== Vaetmark ===')
    v_map = {
        'vatmark_nationell_t01t02_fkartor.20210319': 'NVI_fkartor',
        'satellitbaserad_vatmarkskartering_2018_v1': 'satellit_2018',
        'Uppdat_Palsmyr_170307':                     'palsmyr',
        'Myrskyddsplan_2007_reviderad_2016':         'myrskyddsplan',
        'vatmark_nationell_t01t02_fklass.20210319':  'NVI_fklass',
        'Kartering_inlandssandmarker_2017':          'inlandssandmarker',
        'AM_soilDrainageRestrictionZone':            'EU_INSPIRE_drainage',
        'Smaavlopp_N12':                             'smaavlopp_N12',
    }
    for folder_name, source_label in v_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        for gf in find_geodata(folder):
            if source_label == 'smaavlopp_N12':
                ogr_import(gf, 'env', 'sewage', mode='-overwrite', extra_opts=['-nlt', 'PROMOTE_TO_MULTI'])
            elif source_label == 'EU_INSPIRE_drainage':
                source_layer = 'ManagementRestrictionOrRegulationZone'
                sql = f"SELECT 'EU_INSPIRE_drainage' AS source FROM \"{source_layer}\""
                ogr_import(gf, 'env', 'wetland',
                           extra_opts=['-sql', sql, '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'],
                           mode='-append')
            else:
                # Casting shape_area to avoid numeric overflow
                source_layer = _get_source_layer_name(gf)
                fields = _get_layer_field_names(gf, source_layer)
                shape_area_field = fields.get('shape_area')
                sql = f"SELECT *, '{source_label}' AS source FROM \"{source_layer}\""
                if shape_area_field:
                    sql = f"SELECT *, '{source_label}' AS source, CAST({shape_area_field} AS float) AS shape_area_f FROM \"{source_layer}\""
                ogr_import(gf, 'env', 'wetland',
                           extra_opts=['-sql', sql, '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'],
                           mode='-append')

def import_skog():
    """Skogsanalyser -> env.forest_analytics"""
    log('\n=== Skogsanalyser ===')
    skog_map = {
        'Sannolikt_och_potentiell_kontinuitetsskog_BorealRegion_2022': ('kontinuitetsskog', 2022),
        'Sannolikt_och_potentiell_kontinuitetsskog_BorealRegion_2024': ('kontinuitetsskog', 2024),
        'GPT_potentella_lovskogar':                ('lovskog',       None),
        'analys_boreal_region':                    ('boreal_analys', None),
        'analys_boreonemoral_nemoral_region':      ('nemoral_analys', None),
    }
    for folder_name, (ftype, year) in skog_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        yr = year or 'NULL'
        for gf in find_geodata(folder):
            source_layer = _get_source_layer_name(gf)
            fields = _get_layer_field_names(gf, source_layer)
            geometry_type = ''
            listed_layers = _list_ogr_layers(gf)
            if listed_layers:
                geometry_type = listed_layers[0][1].lower()
            target_table = 'forest_analytics_link' if 'line' in geometry_type else 'forest_analytics'
            shape_leng_expr = f"CAST({fields['shape_leng']} AS float) AS shape_leng" if 'shape_leng' in fields else (
                f"CAST({fields['shape_len']} AS float) AS shape_leng" if 'shape_len' in fields else 'CAST(NULL AS float) AS shape_leng'
            )
            shape_area_expr = f"CAST({fields['shape_area']} AS float) AS shape_area" if 'shape_area' in fields else 'CAST(NULL AS float) AS shape_area'
            patch_id_expr = fields['patch_id'] if 'patch_id' in fields else 'NULL AS patch_id'
            bc_value_expr = f"CAST({fields['bc_value']} AS float) AS bc_value" if 'bc_value' in fields else 'CAST(NULL AS float) AS bc_value'
            sql = (
                f"SELECT {shape_leng_expr}, {shape_area_expr}, {patch_id_expr}, {bc_value_expr}, "
                f"'{ftype}' AS forest_type, {yr} AS year FROM \"{source_layer}\""
            )
            ogr_import(gf, 'env', target_table,
                       extra_opts=['-sql', sql, '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'])

def import_tradslag():
    """NMD Tradslag -> env.forest_species"""
    log('\n=== NMD Tradslag ===')
    folder = resolve_dataset_folder('NMD2023_Tradslag_v1_0')
    if not folder:
        log('  [SAKNAS] NMD2023_Tradslag_v1_0')
        return
    for gf in find_geodata(folder):
        ogr_import(gf, 'env', 'forest_species',
                   extra_opts=['-sql', f"SELECT *, 'NMD2023_Tradslag' AS source FROM \"{gf.stem}\"",
                               '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'])

def import_buller():
    """END Bullerkartor -> env.noise_area"""
    log('\n=== END Strategiska bullerkartor ===')
    folder = resolve_dataset_folder('HH.StrategicNoiseMaps_Sweden_END_Geopackage')
    if not folder:
        log('  [SAKNAS] HH.StrategicNoiseMaps_Sweden_END_Geopackage')
        return
    for gf in find_geodata(folder):
        ogr_import(gf, 'env', 'noise_area',
                   extra_opts=['-sql', f"SELECT *, 'END_2022' AS source FROM \"{gf.stem}\"",
                               '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'])

def import_geofysik():
    """SGU Geofysik -> env.geophysics"""
    log('\n=== SGU Geofysik ===')
    geo_map = {
        'geofysik-flyg-gammastralning-oversiktlig': 'flyg_gamma_ov',
        'geofysik-flyg-gammastralning-detaljerad':  'flyg_gamma_det',
        'geofysik-flyg-em-slingram-detaljerad':     'flyg_em_slingram',
        'geofysik-mark-markradar':                  'mark_radar',
        'geofysik-mark-seismik':                    'mark_seismik',
        'bergkvalitet':                             'bergkvalitet',
        'bergkvalitet-tekniska-analyser':           'bergkvalitet_tekn',
    }
    for folder_name, dtype in geo_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        for gf in find_geodata(folder):
            source_layer = _get_source_layer_name(gf)
            ogr_import(gf, 'env', 'geophysics',
                       extra_opts=['-sql', f"SELECT '{dtype}' AS data_type FROM \"{source_layer}\"",
                                   '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'],
                       source_layer=source_layer)

def import_smhi():
    """SMHI Stationsregister -> climate.smhi_station"""
    log('\n=== SMHI Stationsregister ===')
    smhi_map = {
        'SE_EF_StnReg':                              'stationsreg_full',
        'SE_EF_StnReg_DV_Provfiske':                 'provfiske',
        'SE_EF_StnReg_DV_Naturdata_faglar_fjarilar': 'naturdata',
        'SE_EF_StnReg_DV_Luftkvalitet':              'luftkvalitet',
        'SE_EF_StnReg_Stralningsmatningar':           'stralning',
        'SE_EF_StnReg_DV_Miljogifter':               'miljogifter',
        'SE_EF_StnReg_DV_Oceanografi_marinbiologi':  'oceanografi',
    }
    for folder_name, stype in smhi_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        for gf in find_geodata(folder):
            ogr_import(gf, 'climate', 'smhi_station',
                       src_srs='EPSG:4326', target_srs='EPSG:4326',
                       extra_opts=['-sql', f"SELECT *, '{stype}' AS station_type FROM \"{gf.stem}\"",
                                   '-nlt', 'PROMOTE_TO_MULTI'],
                       mode='-overwrite')

def import_kulturmiljo():
    """Kulturmiljo -> culture.*"""
    log('\n=== Kulturmiljo ===')
    k_map = {
        'nationalMonumentsGML': ('culture', 'monument'),
        'Angs_hagmarksinv':     ('culture', 'agricultural_heritage'),
        'Varldsarv':            ('culture', 'agricultural_heritage'),
    }
    for folder_name, (schema, table) in k_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        for gf in find_geodata(folder):
            ogr_import(gf, schema, table, extra_opts=['-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'])

def import_riksintresse():
    """Riksintresse naturvaard -> env.national_interest"""
    log('\n=== Riksintresse ===')
    ri_map = {
        'RI_Naturvard':    'naturvaard',
        'RI_Friluftsliv':  'friluftsliv',
    }
    for folder_name, itype in ri_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        for gf in find_geodata(folder):
            sql = (
                f"SELECT SKYDD, AMNESOMRAD, NAMN, BESKRIVNIN, LAGRUM, BESLUTSDAT, ORGINALID, RIKSID, "
                f"CAST(SHAPE_AREA AS float) AS shape_area, CAST(SHAPE_LEN AS float) AS shape_len, "
                f"'{itype}' AS interest_type FROM \"{gf.stem}\""
            )
            ogr_import(gf, 'env', 'national_interest',
                       extra_opts=['-sql', sql,
                                    '-nlt', 'PROMOTE_TO_MULTI'],
                       mode='-overwrite')

def import_naturtyp():
    """Naturtypskartan + OECM -> env.habitat_type"""
    log('\n=== Naturtypskartan ===')
    nt_map = {
        'naturtypskartan_RIKS': 'naturtypskartan',
        'oecm_2024':            'oecm_2024',
    }
    for folder_name, source_label in nt_map.items():
        folder = resolve_dataset_folder(folder_name)
        if not folder:
            log(f'  [SAKNAS] {folder_name}')
            continue
        for gf in find_geodata(folder):
            # Hantera faeltnamn foer baade NNK och OECM (Shape_Area vs shape_area)
            # Vi kastar baada till float foer saekerhets skull
            sql = f"SELECT *, '{source_label}' AS source, CAST(shape_area AS float) AS shape_area_f FROM \"{gf.stem}\""
            # Om shape_area inte finns (NNK), proeva Shape_Area
            if 'NNK' in gf.name:
                sql = f"SELECT *, '{source_label}' AS source, CAST(Shape_Area AS float) AS shape_area_f FROM \"{gf.stem}\""
            
            ogr_import(gf, 'env', 'habitat_type',
                       extra_opts=['-sql', sql, '-nlt', 'PROMOTE_TO_MULTI', '-skipfailures'],
                       mode='-append')

# =================================================================
# MAIN
# =================================================================
CATEGORIES = {
    'nvr':         import_nvr,
    'sgu':         import_sgu,
    'msb':         import_msb,
    'vatten':      import_vatten,
    'natura2000':  import_natura2000,
    'nmd':         import_nmd,
    'markfuktig':  import_soil_moisture,
    'vatmark':     import_vatmark,
    'skog':        import_skog,
    'tradslag':    import_tradslag,
    'buller':      import_buller,
    'geofysik':    import_geofysik,
    'smhi':        import_smhi,
    'kulturmiljo': import_kulturmiljo,
    'riksintresse':import_riksintresse,
    'naturtyp':    import_naturtyp,
}

ORDER = [
    'nvr', 'natura2000', 'sgu', 'msb', 'vatten',
    'nmd', 'vatmark', 'naturtyp', 'riksintresse',
    'kulturmiljo', 'skog', 'buller', 'geofysik', 'smhi',
    # Dessa kors separat pga storlek:
    # 'markfuktig', 'tradslag'
]

if __name__ == '__main__':
    cat = sys.argv[1].lower() if len(sys.argv) > 1 else 'alla'
    log(f'=== Import startar: {cat} @ {datetime.now().strftime("%Y-%m-%d %H:%M")} ===')

    if cat == 'alla':
        for c in ORDER:
            CATEGORIES[c]()
    elif cat in CATEGORIES:
        CATEGORIES[cat]()
    else:
        print(f'Okaeend kategori: {cat}')
        print(f'Tillgaeengliga: {", ".join(sorted(CATEGORIES.keys()))} | alla')
        sys.exit(1)

    log(f'=== Import klar @ {datetime.now().strftime("%Y-%m-%d %H:%M")} ===')
