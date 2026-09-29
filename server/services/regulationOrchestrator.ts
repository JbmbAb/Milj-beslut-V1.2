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
  /**
   * W3c: which of the underlying spatial checks could not be completed (distance-to-water, SGU,
   * InSAR, protected-area availability). Never empty when isSensitiveArea is true solely because
   * of an unresolved check -- see the isSensitiveArea computation below. An unresolved check is
   * conservative-by-default: a false positive here means stricter review, a false negative means
   * an actually-sensitive site goes undetected.
   */
  spatialDataUnresolved: string[];
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
  const distanceKnown = spatialAudit.distanceToWaterMeters !== null;
  const isNearWater = distanceKnown && spatialAudit.distanceToWaterMeters! < 100;
  // W3c (M1): a checked site with nothing within range also reports distanceToWaterMeters:null --
  // only the absence of `distanceToWaterAvailable:true` means the check itself could not run.
  const distanceUnresolved = !distanceKnown && spatialAudit.distanceToWaterAvailable !== true;

  // W3c (M2): sgu.manualReviewRequired is true in the normal 'sample' coverage default and on a
  // genuine landslide finding, not only on failure -- it is not a fail-open signal. The actual
  // failure signal is sgu.flags containing 'sgu:unavailable', set only when the SGU audit itself
  // could not be completed.
  const sguUnresolved = spatialAudit.sgu?.flags?.includes('sgu:unavailable') ?? false;
  const hasHighSoilVulnerability = !sguUnresolved && spatialAudit.sgu?.riskLevel === 'HIGH';

  const insarUnresolved = spatialAudit.insar?.warningFlags?.includes('insar:unavailable') ?? false;

  const protectedAreaUnresolved = spatialAudit.protectedAreaAvailable !== true;

  const spatialDataUnresolved: string[] = [];
  if (distanceUnresolved) spatialDataUnresolved.push('distance-to-water-unavailable');
  if (sguUnresolved) spatialDataUnresolved.push('sgu-unavailable');
  if (insarUnresolved) spatialDataUnresolved.push('insar-unavailable');
  if (protectedAreaUnresolved) spatialDataUnresolved.push('protected-area-unavailable');

  const isSensitiveArea = isProtected || isNearWater || hasHighSoilVulnerability || spatialDataUnresolved.length > 0;

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
  if (spatialDataUnresolved.length > 0) {
    sensitiveReasons.push('ofullständigt geodataunderlag (kräver manuell kontroll)');
  }

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
    spatialDataUnresolved,
    spatialFindings: {
      isProtected,
      distanceToWater: spatialAudit.distanceToWaterMeters,
      soilType: spatialAudit.sgu.groundLayer.hit?.layerLabel || null,
    },
    mpfDetails: mpfEvaluation,
    summary
  };
}
