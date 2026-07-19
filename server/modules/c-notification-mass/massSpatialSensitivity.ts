import type { MassGISAnalysis } from '../../../src/types/mass';
import { isSensitiveAreaFromMassGis } from '../../../services/massSpatialSensitivity';
import { runSpatialAudit } from '../../services/spatialAuditService';

export type MassSensitivitySource = 'explicit' | 'gis-analysis' | 'spatial-audit' | 'default';

export interface MassSiteSensitivity {
  isSensitiveArea: boolean;
  source: MassSensitivitySource;
}

export { isSensitiveAreaFromMassGis };

export async function resolveMassSiteSensitivity(input: {
  isSensitiveArea?: boolean;
  gisAnalysis?: MassGISAnalysis;
  siteLat?: number;
  siteLng?: number;
}): Promise<MassSiteSensitivity> {
  if (input.isSensitiveArea === true) {
    return { isSensitiveArea: true, source: 'explicit' };
  }

  if (input.gisAnalysis) {
    return {
      isSensitiveArea: isSensitiveAreaFromMassGis(input.gisAnalysis),
      source: 'gis-analysis',
    };
  }

  if (input.siteLat != null && input.siteLng != null) {
    const spatialAudit = await runSpatialAudit(input.siteLat, input.siteLng);
    const isNearWater =
      spatialAudit.distanceToWaterMeters !== null && spatialAudit.distanceToWaterMeters < 100;
    const hasHighSoilVulnerability = spatialAudit.sgu.riskLevel === 'HIGH';

    return {
      isSensitiveArea: spatialAudit.isProtected || isNearWater || hasHighSoilVulnerability,
      source: 'spatial-audit',
    };
  }

  return { isSensitiveArea: false, source: 'default' };
}
