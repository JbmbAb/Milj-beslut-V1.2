import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateBankComplianceIndex } from '../../server/services/bankComplianceService';
import type { RiskLevel } from '../../server/services/complianceRuleEngine';

vi.mock('../../server/services/complianceRuleEngine', () => ({
  evaluateComplianceRules: vi.fn(),
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: {},
}));

import { evaluateComplianceRules } from '../../server/services/complianceRuleEngine';

const mockSiteAnalysis = (
  rules: {
    ruleId: string;
    risk: RiskLevel;
    description: string;
    chapter?: string;
    title?: string;
    recommendation?: string;
  }[],
) => ({
  overallRisk: 'LOW' as const,
  permitProbability: 0.9,
  restrictions: [],
  summary: 'Test',
  rules: rules.map((r) => ({
    ruleId: r.ruleId,
    risk: r.risk,
    description: r.description,
    chapter: r.chapter ?? '1',
    title: r.title ?? 'Test',
    recommendation: r.recommendation ?? '',
  })),
});

describe('generateBankComplianceIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returnerar rapport med korrekt projectId', async () => {
    vi.mocked(evaluateComplianceRules).mockReturnValue(mockSiteAnalysis([]));
    const report = await generateBankComplianceIndex('proj-abc');
    expect(report.projectId).toBe('proj-abc');
    expect(report.generatedAt).toBeInstanceOf(Date);
  });

  it('returnerar 100 i compliance-poäng när inga regler utlöses', async () => {
    vi.mocked(evaluateComplianceRules).mockReturnValue(mockSiteAnalysis([]));
    const report = await generateBankComplianceIndex('proj-1');
    expect(report.overallComplianceScore).toBe(100);
    expect(report.taxonomyAligned).toBe(true);
    expect(report.redFlags).toBe(0);
    expect(report.yellowFlags).toBe(0);
    expect(report.greenFlags).toBe(0);
  });

  it('räknar röda flaggor och minskar poängen med 20 per röd flagga', async () => {
    vi.mocked(evaluateComplianceRules).mockReturnValue(
      mockSiteAnalysis([
        { ruleId: 'R1', risk: 'HIGH', description: 'Riskfaktor 1' },
        { ruleId: 'R2', risk: 'BLOCK', description: 'Blockering' },
      ]),
    );
    const report = await generateBankComplianceIndex('proj-2');
    expect(report.redFlags).toBe(2);
    expect(report.overallComplianceScore).toBe(60); // 100 - 2*20
    expect(report.taxonomyAligned).toBe(false); // redFlags > 0
  });

  it('räknar gula flaggor och minskar poängen med 5 per gul flagga', async () => {
    vi.mocked(evaluateComplianceRules).mockReturnValue(
      mockSiteAnalysis([
        { ruleId: 'M1', risk: 'MEDIUM', description: 'Medium risk' },
        { ruleId: 'M2', risk: 'MEDIUM', description: 'Medium risk 2' },
      ]),
    );
    const report = await generateBankComplianceIndex('proj-3');
    expect(report.yellowFlags).toBe(2);
    expect(report.overallComplianceScore).toBe(90); // 100 - 2*5
    expect(report.taxonomyAligned).toBe(true); // score>70 och inga röda
  });

  it('räknar gröna flaggor korrekt', async () => {
    vi.mocked(evaluateComplianceRules).mockReturnValue(
      mockSiteAnalysis([
        { ruleId: 'L1', risk: 'LOW', description: 'Låg risk' },
        { ruleId: 'L2', risk: 'LOW', description: 'Låg risk 2' },
        { ruleId: 'L3', risk: 'LOW', description: 'Låg risk 3' },
      ]),
    );
    const report = await generateBankComplianceIndex('proj-4');
    expect(report.greenFlags).toBe(3);
    expect(report.overallComplianceScore).toBe(100);
    expect(report.taxonomyAligned).toBe(true);
  });

  it('poäng är aldrig negativ vid många röda flaggor', async () => {
    vi.mocked(evaluateComplianceRules).mockReturnValue(
      mockSiteAnalysis([
        { ruleId: 'R1', risk: 'HIGH', description: 'Hög risk 1' },
        { ruleId: 'R2', risk: 'HIGH', description: 'Hög risk 2' },
        { ruleId: 'R3', risk: 'HIGH', description: 'Hög risk 3' },
        { ruleId: 'R4', risk: 'BLOCK', description: 'Block 1' },
        { ruleId: 'R5', risk: 'BLOCK', description: 'Block 2' },
        { ruleId: 'R6', risk: 'BLOCK', description: 'Block 3' },
      ]),
    );
    const report = await generateBankComplianceIndex('proj-5');
    expect(report.overallComplianceScore).toBe(0);
    expect(report.taxonomyAligned).toBe(false);
  });

  it('taxonomyAligned är false om score <= 70 trots inga röda flaggor', async () => {
    // 7 medium flags → 100 - 35 = 65 → taxonomyAligned false
    const mediumRules: Array<{ ruleId: string; risk: RiskLevel; description: string }> = Array.from(
      { length: 7 },
      (_, i) => ({
        ruleId: `M${i}`,
        risk: 'MEDIUM',
        description: `Medium ${i}`,
      }),
    );
    vi.mocked(evaluateComplianceRules).mockReturnValue(mockSiteAnalysis(mediumRules));
    const report = await generateBankComplianceIndex('proj-6');
    expect(report.overallComplianceScore).toBe(65);
    expect(report.taxonomyAligned).toBe(false);
  });

  it('details innehåller korrekt mappade regelresultat', async () => {
    vi.mocked(evaluateComplianceRules).mockReturnValue(
      mockSiteAnalysis([{ ruleId: 'MB-1', risk: 'HIGH', description: 'Miljöbalken 9 kap.' }]),
    );
    const report = await generateBankComplianceIndex('proj-7');
    expect(report.details).toHaveLength(1);
    expect(report.details[0]).toMatchObject({
      ruleId: 'MB-1',
      risk: 'HIGH',
      description: 'Miljöbalken 9 kap.',
    });
  });
});
