/**
 * Lastkajen – kartlager kopplade till PostGIS-tabeller efter import.
 */

import type { PlatformDatasetMapLayer } from './platformMapLayerRegistry';
import { getImportableLastkajenJobs, LASTKAJEN_IMPORT_JOBS } from './lastkajenImportManifest';

function parseTableRef(tableRef: string): { schema: string; table: string } {
  const [schema, table] = tableRef.split('.');
  if (!schema || !table) {
    throw new Error(`Invalid table reference: ${tableRef}`);
  }
  return { schema, table };
}

/** Kartlager för en-tabell-jobb (single, merge, vilt, filegdb primär). per_gpkg_zip skapar flera tabeller utan kartlager här. */
export const LASTKAJEN_MAP_LAYERS: PlatformDatasetMapLayer[] = getImportableLastkajenJobs(
  LASTKAJEN_IMPORT_JOBS,
).filter((job) => job.mode !== 'per_gpkg_zip').map((job) => {
  const { schema, table } = parseTableRef(job.table);
  return {
    key: job.key,
    label: job.label,
    schema,
    table,
    geometry: job.geometry,
    bboxRequired: true,
    provider: 'Trafikverket / Lastkajen',
    style: job.style,
    minZoom: job.minZoom,
  };
});

export function findLastkajenMapLayer(key: string): PlatformDatasetMapLayer | undefined {
  return LASTKAJEN_MAP_LAYERS.find((l) => l.key === key);
}
