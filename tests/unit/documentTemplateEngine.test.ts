import { describe, expect, it } from 'vitest';
import { renderCompliancePlanTemplate } from '../../services/documentTemplateEngine';

describe('documentTemplateEngine', () => {
  it('renders template with provided variables', () => {
    const vars = {
      projectName: 'Test Project',
      municipality: 'Stockholm',
      wasteTypes: ['17 05 04', '17 05 03*'],
      totalVolumeTons: 1500,
      riskScore: 'MEDIUM',
      riskFactors: ['Factor 1', 'Factor 2'],
      aiMitigationAdvice: 'Use cover.',
    };

    const output = renderCompliancePlanTemplate(vars);
    expect(output).toContain('Test Project');
    expect(output).toContain('Stockholm');
    expect(output).toContain('17 05 04, 17 05 03*');
    expect(output).toContain('1500 ton');
    expect(output).toContain('[ MEDIUM ]');
    expect(output).toContain('- Factor 1');
    expect(output).toContain('Use cover.');
  });

  it('handles empty risk factors and advice', () => {
    const output = renderCompliancePlanTemplate({
      projectName: 'A',
      municipality: 'B',
      wasteTypes: [],
      totalVolumeTons: 10,
      riskScore: 'LOW',
      riskFactors: [],
    });
    expect(output).toContain('Inga förhöjda risker');
    expect(output).toContain('Inväntar detaljerad rådgivning');
  });
});
