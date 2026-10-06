import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/modules/ai/generation/LocalGenerationPort', () => ({
  generateText: vi.fn(async () => 'Sammanfattning från Vertex'),
}));

vi.mock('../../server/services/complianceRuleEngine', () => ({
  evaluateComplianceRules: vi.fn(() => ({
    overallRisk: 'LOW',
    permitProbability: 70,
    restrictions: [],
    rules: [
      {
        ruleId: 'MB_7',
        chapter: '7 kap MB',
        title: 'Skyddszon',
        risk: 'LOW',
        description: '',
        recommendation: '',
      },
    ],
    summary: 'Screening klar',
  })),
}));

import { evaluateComplianceRules } from '../../server/services/complianceRuleEngine';
import { generateText } from '../../server/modules/ai/generation/LocalGenerationPort';
import { analyzeBiodiversityWithCompliance } from '../../server/services/geminiBiodiversityService';

describe('geminiBiodiversityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('kör evaluateComplianceRules och Vertex på servern', async () => {
    const result = await analyzeBiodiversityWithCompliance(59.33, 18.07, [], [], undefined, []);

    expect(evaluateComplianceRules).toHaveBeenCalled();
    expect(generateText).toHaveBeenCalled();
    expect(result.summary).toBe('Sammanfattning från Vertex');
    expect(result.compliance?.rules).toHaveLength(1);
  });

  it('kastar när Vertex saknar svar', async () => {
    vi.mocked(generateText).mockResolvedValueOnce('');

    await expect(analyzeBiodiversityWithCompliance(59.33, 18.07)).rejects.toThrow(/verifierad AI-källa/);
  });
});
