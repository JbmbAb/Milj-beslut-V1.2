import { runSpatialAudit } from './spatialAuditService';
import { evaluateMpfOperation, MpfOperationEvaluation } from '../../services/mpfEngine';
import { logger } from '../logger';

export interface RegulatoryClassifyRequest {
  lat: number;
  lng: number;
  ewcCode: string;
  sniCode?: string;
  annualVolume: number;
}

export interface RegulatoryClassification {
  permitClass: 'A' | 'B' | 'C' | 'U';
  isSensitiveArea: boolean;
  spatialFindings: {
    isProtected: boolean;
    distanceToWater: number | null;
    soilType?: string;
  };
  mpfDetails: MpfOperationEvaluation;
  summary: string;
}

/**
 * Miljöprövningsförordningen (MPF) Orchestrator.
 * 
 * Bridges optimized PostGIS spatial data with regulatory threshold logic
 * to determine the legal permit track for a project.
 */
export async function classifyProjectRegulatoryTrack(
  req: RegulatoryClassifyRequest
): Promise<RegulatoryClassification> {
  logger.info('Regulatory Orchestrator: Starting classification', { 
    code: req.ewcCode, 
    vol: req.annualVolume 
  });

  // 1. Run Optimized Spatial Audit (Geofencing)
  // This uses the parallelized PostGIS queries we optimized in Phase 1-3.
  const spatialAudit = await runSpatialAudit(req.lat, req.lng);

  // 2. Determine Spatial Sensitivity
  // Criteria for sensitive location that triggers lower MPF thresholds:
  const isProtected = spatialAudit.isProtected;
  const isNearWater = spatialAudit.distanceToWaterMeters !== null && spatialAudit.distanceToWaterMeters < 100;
  const hasHighSoilVulnerability = spatialAudit.sgu.riskLevel === 'HIGH';
  
  const isSensitiveArea = isProtected || isNearWater || hasHighSoilVulnerability;

  // 3. Evaluate MPF Thresholds with Spatial Awareness
  const mpfEvaluation = evaluateMpfOperation({
    ewcCode: req.ewcCode,
    sniCode: req.sniCode,
    quantity: req.annualVolume,
    isSensitiveArea,
    strategy: 'strongest-wins'
  });

  // 4. Construct Final Response
  const permitClass = mpfEvaluation.permitClass || 'U';
  
  const sensitiveReasons: string[] = [];
  if (isProtected) sensitiveReasons.push('skyddad natur');
  if (isNearWater) sensitiveReasons.push('närhet till vatten');
  if (hasHighSoilVulnerability) sensitiveReasons.push('hög grundvattensårbarhet');

  const summary = [
    `Verksamheten klassas som ${permitClass}-verksamhet enligt MPF.`,
    isSensitiveArea 
      ? `Platsen bedöms som känslig p.g.a. ${sensitiveReasons.join(', ')} vilket påverkar tröskelvärdena.` 
      : 'Platsen bedöms inte ligga i ett särskilt känsligt läge.',
    mpfEvaluation.notes
  ].join(' ');

  return {
    permitClass,
    isSensitiveArea,
    spatialFindings: {
      isProtected,
      distanceToWater: spatialAudit.distanceToWaterMeters,
      soilType: spatialAudit.sgu.groundLayer.hit?.layerLabel || null,
    },
    mpfDetails: mpfEvaluation,
    summary
  };
}
