import { describe, expect, it } from 'vitest';
import { presentLuFinding } from '../../components/app/lu/luFindingPresentation';

describe('LU-RESULT-PRESENTATION-MODEL-V1', () => {
  it.each([
    ['LU-WATER-001', 'WATER', 'Vatten'],
    ['LU-EBH-001', 'EBH', 'Förorenad mark'],
    ['LU-PROTECTED-001', 'PROTECTED_AREA', 'Skydd'],
    ['LU-NATURA2000-001', 'NATURA2000', 'Natura 2000'],
    ['LU-WATERPROTECTION-001', 'WATER_PROTECTION_AREA', 'Vattenskyddsområde'],
    ['LU-DOC-BESLUT-001', 'DOCUMENT_DECISION', 'Tidigare beslut'],
  ] as const)('maps %s to category %s / label %s', (rule_id, category, categoryLabel) => {
    const presentation = presentLuFinding({ rule_id, risk_level: 'MEDIUM' });
    expect(presentation.category).toBe(category);
    expect(presentation.categoryLabel).toBe(categoryLabel);
  });

  it('maps an unrecognized rule_id to the explicit UNKNOWN category instead of dropping or mis-categorizing it', () => {
    const presentation = presentLuFinding({ rule_id: 'LU-SOME-FUTURE-RULE-001', risk_level: 'HIGH' });
    expect(presentation.category).toBe('UNKNOWN');
    expect(presentation.categoryLabel).toBe('Övrigt');
  });

  it.each([
    ['HIGH', 'Kräver uppmärksamhet'],
    ['MEDIUM', 'Bör utredas vidare'],
    ['LOW', 'Låg risk'],
  ] as const)('maps risk_level %s to attention label %s', (risk_level, attentionLabel) => {
    const presentation = presentLuFinding({ rule_id: 'LU-WATER-001', risk_level });
    expect(presentation.attentionLabel).toBe(attentionLabel);
  });
});
