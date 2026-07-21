import { ComplianceProfile, TaxonomyIndicator } from './compliance';

export interface IComplianceRepository {
  saveProfile(profile: ComplianceProfile): Promise<ComplianceProfile>;
  findLatestProfile(projectId: string): Promise<ComplianceProfile | null>;
  getAllIndicators(): Promise<TaxonomyIndicator[]>;
}
