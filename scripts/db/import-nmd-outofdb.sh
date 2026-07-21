#!/bin/sh

ARCHIVE_ROOT="${GEO_MASTER_ARCHIVE_ROOT:-/var/lib/postgresql/data/geo_master_archive}"
TARGET_TABLE="${NMD_TARGET_TABLE:-env.nmd_2023}"
PSQL_TARGET="${PSQL_TARGET:-miljobeslut}"

NMD_FILES=$(find "$ARCHIVE_ROOT" -type f \( -iname 'NMD*.tif' -o -iname '*NMD*2023*.tif' \) | sort)

if [ -z "$NMD_FILES" ]; then
  echo "No NMD GeoTIFF files found under $ARCHIVE_ROOT" >&2
  exit 1
fi

echo "Importing NMD file(s) into ${TARGET_TABLE} using out-of-db registration..."
psql -U miljobeslut -d "$PSQL_TARGET" -c 'CREATE SCHEMA IF NOT EXISTS env;'

for file in $NMD_FILES; do
  raster2pgsql -s 3006 -t 256x256 -R -I -C -M "$file" "$TARGET_TABLE" | psql -U miljobeslut -d "$PSQL_TARGET"
done
