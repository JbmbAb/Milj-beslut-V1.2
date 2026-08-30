import { describe, expect, it } from 'vitest';
import { deriveLuComparisonStatus, type SiteAnalysisResult } from '../generate-localization-report.usecase';

function assessedSite(id: string, dataSources: SiteAnalysisResult['dataSources']): SiteAnalysisResult {
  return {
    site: { id, lat: 59, lng: 18 },
    spatialAudit: {} as SiteAnalysisResult['spatialAudit'],
    complianceAnalysis: {
      assessment_status: 'ASSESSED',
      overallRisk: 'LOW',
      permitProbability: 0.9,
      restrictions: [],
      rules: [],
      summary: 'governed',
      violations: [],
      warnings: [],
      feasibilityScore: 90,
      recommendations: [],
    },
    monuments: [],
    vissWaterStatus: null,
    distanceToWaterMeters: null,
    dataSources,
    warnings: [],
    sluObservationCount: 0,
    executionMotor: {
      admitted: true,
      reason_codes: [],
      attempt_id: 'attempt-h3',
      outcome_id: 'outcome-h3',
      manifest_id: 'manifest-h3',
      ticket_id: 'ticket-h3',
      finding_ids: [],
      assessment_artifact_id: `assessment-${id}`,
      assessment_projection_registered: true,
      property_context_id: 'property-h3',
      assessment_status: 'ASSESSED',
      findings: [],
    },
  };
}

describe('H3 coverage/verdict comparison invariant', () => {
  it('does not report COMPLETE when an assessed verdict was produced with unavailable coverage', () => {
    const status = deriveLuComparisonStatus([
      assessedSite('site-a', [
        { source: 'PostGIS spatial', status: 'ok' },
        { source: 'NVR API', status: 'unavailable', detail: 'timeout' },
      ]),
    ]);

    expect(status).toBe('PARTIAL');
  });

  it('reports COMPLETE only when every candidate is assessed and all coverage sources are ok', () => {
    const status = deriveLuComparisonStatus([
      assessedSite('site-a', [
        { source: 'PostGIS spatial', status: 'ok' },
        { source: 'NVR API', status: 'ok' },
      ]),
      assessedSite('site-b', [
        { source: 'PostGIS spatial', status: 'ok' },
        { source: 'NVR API', status: 'ok' },
      ]),
    ]);

    expect(status).toBe('COMPLETE');
  });
});
