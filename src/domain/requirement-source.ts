/**
 * REQUIREMENT SOURCE DOMAIN
 * Representerar källan till ett krav, t.ex. en lagparagraf, en dom eller en standard.
 */

export enum RequirementSourceType {
  LAW = 'LAW',
  REGULATION = 'REGULATION',
  COURT_RULING = 'COURT_RULING',
  STANDARD = 'STANDARD',
  INTERNAL = 'INTERNAL',
  PROJECT_SPECIFIC = 'PROJECT_SPECIFIC',
}

export interface RequirementSource {
  id: string;
  name: string; // T.ex. "Miljöbalken 7 kap. 2 §"
  type: RequirementSourceType;
  sourceIdentifier: string; // T.ex. "SFS 1998:808" eller URL
  version?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}
