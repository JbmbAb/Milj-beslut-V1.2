export type MassLogisticsSuitability = 'SUITABLE' | 'REVIEW_REQUIRED' | 'RESTRICTED';

export type MassSiteConstraintSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface MassSiteConstraint {
  code: string;
  label: string;
  severity: MassSiteConstraintSeverity;
}

export interface MassGISAnalysis {
  propertyDesignation: string;
  timestamp: string;
  centroid: { lat: number; lng: number };
  municipalityCode?: string;
  municipalityName?: string;
  propertyAreaM2?: number;
  markCover?: { nmdCode: number; description: string };
  siteConstraints: MassSiteConstraint[];
  overallRiskScore: number;
  logisticsSuitability: MassLogisticsSuitability;
  warnings: string[];
  reasoning: string[];
}

export interface MassSiteZone {
  id: string;
  label: string;
  operationType: 'MELLANLAGRING' | 'DEPONI' | 'TRANSIT';
  offsetM: number;
}

export interface MassSiteProfile {
  propertyDesignation: string;
  centroid: { lat: number; lng: number };
  recommendedZones: MassSiteZone[];
  source: string;
}

export interface MassGisAnalysisRequest {
  projectId: string;
  propertyDesignation: string;
}

export interface MassGisAnalysisResponse {
  analysis: MassGISAnalysis;
  siteProfile: MassSiteProfile;
  propertySource: string;
}

/** Sparas på ärendet och följer med export/PDF. */
export interface MassGisSnapshot {
  analysis: MassGISAnalysis;
  siteProfile: MassSiteProfile;
  analyzedAt: string;
  propertySource?: string;
}
