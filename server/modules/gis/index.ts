/**
 * GIS module boundary.
 *
 * All GIS-layer retrieval should flow through this module so GIS can be
 * extracted to a separate service later without rewriting route code.
 */

import type { Bbox } from '../../utils/geo/bbox';
import { getDatasetMapLayer } from '../../services/postgisLayerService';

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

export async function getMainCatchmentLayer(bbox: Bbox) {
  return getDatasetMapLayer('smhi_huvudavrinningsomraden', bbox, 1500);
}
