import type { MassGISAnalysis } from '../../../src/types/mass';
import { isSensitiveAreaFromMassGis } from '../../../services/massSpatialSensitivity';
import { runSpatialAudit } from '../../services/spatialAuditService';

export type MassSensitivitySource = 'explicit' | 'gis-analysis' | 'spatial-audit' | 'default';

export interface MassSiteSensitivity {
  isSensitiveArea: boolean;
  source: MassSensitivitySource;
  /**
   * W3c: which of the underlying spatial checks (distance-to-water, SGU, InSAR, protected-area
   * availability) could not be completed. Always empty for the 'explicit'/'gis-analysis'/'default'
   * sources, since only the 'spatial-audit' path reads these signals.
   */
  spatialDataUnresolved: string[];
}

export { isSensitiveAreaFromMassGis };

export async function resolveMassSiteSensitivity(input: {
  isSensitiveArea?: boolean;
  gisAnalysis?: MassGISAnalysis;
  siteLat?: number;
  siteLng?: number;
}): Promise<MassSiteSensitivity> {
  if (input.isSensitiveArea === true) {
    return { isSensitiveArea: true, source: 'explicit', spatialDataUnresolved: [] };
  }

  if (input.gisAnalysis) {
    return {
      isSensitiveArea: isSensitiveAreaFromMassGis(input.gisAnalysis),
      source: 'gis-analysis',
      spatialDataUnresolved: [],
    };
  }

  if (input.siteLat != null && input.siteLng != null) {
    const spatialAudit = await runSpatialAudit(input.siteLat, input.siteLng);

    const distanceKnown = spatialAudit.distanceToWaterMeters !== null;
    const isNearWater = distanceKnown && spatialAudit.distanceToWaterMeters! < 100;
    // W3c (M1): a checked site with nothing within range also reports distanceToWaterMeters:null
    // -- only the absence of distanceToWaterAvailable:true means the check could not run.
    const distanceUnresolved = !distanceKnown && spatialAudit.distanceToWaterAvailable !== true;

    // W3c (M2): sgu.manualReviewRequired is true in the normal 'sample' coverage default and on a
    // genuine landslide finding, not only on failure -- the real failure signal is sgu.flags
    // containing 'sgu:unavailable'.
    const sguUnresolved = spatialAudit.sgu?.flags?.includes('sgu:unavailable') ?? false;
    const hasHighSoilVulnerability = !sguUnresolved && spatialAudit.sgu?.riskLevel === 'HIGH';

    const insarUnresolved = spatialAudit.insar?.warningFlags?.includes('insar:unavailable') ?? false;

    const protectedAreaUnresolved = spatialAudit.protectedAreaAvailable !== true;

    const spatialDataUnresolved: string[] = [];
    if (distanceUnresolved) spatialDataUnresolved.push('distance-to-water-unavailable');
    if (sguUnresolved) spatialDataUnresolved.push('sgu-unavailable');
    if (insarUnresolved) spatialDataUnresolved.push('insar-unavailable');
    if (protectedAreaUnresolved) spatialDataUnresolved.push('protected-area-unavailable');

    return {
      isSensitiveArea:
        spatialAudit.isProtected || isNearWater || hasHighSoilVulnerability || spatialDataUnresolved.length > 0,
      source: 'spatial-audit',
      spatialDataUnresolved,
    };
  }

  return { isSensitiveArea: false, source: 'default', spatialDataUnresolved: [] };
}
