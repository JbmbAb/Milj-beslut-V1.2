#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_ROOT="${GEO_MASTER_ARCHIVE_ROOT:-/mnt/geo_master_archive}"
TARGET_TABLE="${NMD_TARGET_TABLE:-env.nmd_2023}"
PSQL_TARGET="${PSQL_TARGET:-${DATABASE_URL:-miljobeslut}}"

mapfile -t NMD_FILES < <(find "$ARCHIVE_ROOT" -type f \( -iname 'NMD*.tif' -o -iname '*NMD*2023*.tif' \) | sort)

if [[ ${#NMD_FILES[@]} -eq 0 ]]; then
  echo "No NMD GeoTIFF files found under $ARCHIVE_ROOT" >&2
  exit 1
fi

echo "Importing ${#NMD_FILES[@]} NMD file(s) into ${TARGET_TABLE} using out-of-db registration..."
psql "$PSQL_TARGET" -c 'CREATE SCHEMA IF NOT EXISTS env;'
raster2pgsql -s 3006 -R -I -C -M "${NMD_FILES[@]}" "$TARGET_TABLE" | psql "$PSQL_TARGET"
