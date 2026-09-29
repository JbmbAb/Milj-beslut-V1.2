import { RiskLevel } from './complianceRuleEngine';
import { SecureError } from '../security/secureErrors';

export interface BankComplianceReport {
  projectId: string;
  generatedAt: Date;
  overallComplianceScore: number; // 0-100
  taxonomyAligned: boolean;
  redFlags: number;
  yellowFlags: number;
  greenFlags: number;
  details: {
    ruleId: string;
    description: string;
    risk: RiskLevel;
  }[];
}

/**
 * Generates a compliance index report tailored for banks and financial institutions.
 * Maps project findings to EU Taxonomy and ESG requirements.
 */
export async function generateBankComplianceIndex(projectId: string): Promise<BankComplianceReport> {
  // HD-01 (A9 sweep, 2026-09-29): this used to call evaluateComplianceRules([], [], {} as any, [])
  // — no real project data was ever fetched — and still returned a report claiming a specific
  // score (always 100) and "EU-taxonomi-anpassad: true" for every project. A bank consuming this
  // endpoint could not tell a real assessment from an empty one. Real project-data loading
  // (observations, protectedAreas, geological data) is a separate, future unit, not this fix:
  // until that data source is wired, refuse explicitly rather than fabricate a passing score.
  throw new SecureError(
    `generateBankComplianceIndex(${projectId}): no real project data source is wired (observations/protectedAreas/geological/monuments); refusing to fabricate a compliance score.`,
    'Bank compliance index is not available yet: no real risk data source is connected for this project.',
    501,
    'BANK_COMPLIANCE_NOT_IMPLEMENTED',
  );
}
