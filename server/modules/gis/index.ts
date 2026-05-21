/**
 * GIS module boundary.
 *
 * All GIS-layer retrieval should flow through this module so GIS can be
 * extracted to a separate service later without rewriting route code.
 */

export { parseBbox, type Bbox } from '../../utils/geo/bbox';

export {
  getRaaFornlamningFeatureCollectionForBbox,
  getProtectedAreaLayer,
  getNatura2000Layer,
  getInternationalProtectionLayer,
  getWaterProtectionLayer,
  getSguGroundLayerLayer,
  getSguLandslideLayer,
  getFloodRiskLayer,
  runWaterAudit,
  runHeritageAudit,
  runClimateAudit,
  getPublicDatasourceSummary,
  getHydroLayer,
  getSguWellLayer,
  getSguPermeabilityLayer,
  getSguGroundwaterMagazineLayer,
  getSguGroundwaterBodyLayer,
  getSguCoastalErosionLayer,
  getSguHighestCoastlineLayer,
  getWaterCatchmentLayer,
  getTopo10Layer,
} from '../../services/publicUiService';

export { getMarkCoverLayer, queryMarkCoverAtPoint } from '../../services/markCoverService';
export { getPropertyLayer } from '../../services/propertyUnitService';
