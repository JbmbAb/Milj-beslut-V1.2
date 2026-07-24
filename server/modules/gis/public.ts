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
export { getArcGisLayerAsGeoJson } from '../../services/arcgisProxyService';
export { getNmdOutOfDbBandPath, queryNmdRasterPoint, getNmdVectorTile } from './index';
export { getPublicDatasourceSummary, parseBbox } from '../../services/publicUiService';
export { getMarkCoverLayer } from '../../services/markCoverService';
export { auditInSarRiskAtPoint } from '../../services/sgiInSarService';
export { getOgcCatalogLayers, listOgcCatalogSummaries } from '../../services/ogcCapabilitiesService';
export {
  downloadDataPackageFileToPath,
  getLastkajenStatus,
  listDataPackageFiles,
  listPublishedDataPackages,
  pingLastkajen,
} from '../../services/lastkajenService';
export {
  calculateRadialOpenAquifer,
  calculateOneDimOpenAquifer,
  calculateRadialConfinedAquifer,
  calculateOneDimConfinedAquifer,
  estimateInfluenceRadiusSichardt,
} from '../../services/groundwaterInfluenceService';
export type { GroundwaterModelInput } from '../../services/groundwaterInfluenceService';
export {
  calculateStormwaterDetention,
  calculateVaProjectClimate,
} from '../../services/svensktVattenService';
export type { StormwaterCalculationInput, VaClimateInput } from '../../services/svensktVattenService';
export { calculateGeoKalkyl } from '../../services/geoKalkylService';
export type { GeoKalkylInput, GeoKalkylResult, GeoKalkylSegment } from '../../services/geoKalkylService';

