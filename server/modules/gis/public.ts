/**
 * GIS module public API — all GIS/Geo route dependencies must import from here, not from services.
 */
export * from './index';
export { getTerrainData } from '../../services/terrainService';
export { buildCulturalEnvironmentDownloadBundle } from '../../services/culturalEnvironmentBundleService';
export { searchKsamsokBoundingBox } from '../../services/ksamsokService';
export { getLantmaterietOpenMapStatus } from '../../services/lantmaterietService';
export {
  listOpenDataCatalog,
  pingAllOpenDataProducts,
  pingOpenDataProduct,
} from '../../services/lantmaterietOpenDataService';
export { fetchImmediateOpenSources } from '../../services/openDataSourceService';
export {
  callSluProductApi,
  getSluProductStatus,
  pingSluProduct,
  searchSluObservations,
} from '../../services/sluService';
export type { SluProduct } from '../../services/sluService';
export { getSmhiWeatherRisk } from '../../services/smhiWeatherService';
export { runSpatialAudit } from '../../services/spatialAuditService';
export { getPostgisExtendedHealth } from './adapters/postgisHealth';
export { getDatasetMapLayer } from '../../services/postgisLayerService';
