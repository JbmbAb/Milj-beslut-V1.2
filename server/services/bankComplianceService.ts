import { evaluateComplianceRules, RiskLevel } from './complianceRuleEngine';

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
  // 1. Fetch project data (mocked/simplified for this service)
  // In reality we would fetch observations, protectedAreas, geological data, etc. from the DB
  // via project repository
  const rulesResult = evaluateComplianceRules([], [], {} as any, []);

  let redFlags = 0;
  let yellowFlags = 0;
  let greenFlags = 0;

  const details = rulesResult.rules.map((r) => {
    if (r.risk === 'BLOCK' || r.risk === 'HIGH') {
      redFlags++;
    } else if (r.risk === 'MEDIUM') {
      yellowFlags++;
    } else {
      greenFlags++;
    }
    return {
      ruleId: r.ruleId,
      description: r.description,
      risk: r.risk,
    };
  });

  // Calculate a mock score (0-100)
  // Base 100, -20 per red flag, -5 per yellow flag
  let score = 100 - redFlags * 20 - yellowFlags * 5;
  if (score < 0) score = 0;

  // Taxonomy alignment is true if score > 70 and no red flags
  const taxonomyAligned = score >= 70 && redFlags === 0;

  return {
    projectId,
    generatedAt: new Date(),
    overallComplianceScore: score,
    taxonomyAligned,
    redFlags,
    yellowFlags,
    greenFlags,
    details,
  };
}
