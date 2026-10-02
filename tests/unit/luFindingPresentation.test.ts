import { describe, expect, it } from 'vitest';
import { presentLuFinding, presentLuFindingSummary } from '../../components/app/lu/luFindingPresentation';

describe('LU-RESULT-PRESENTATION-MODEL-V1', () => {
  it.each([
    // DEMO M2a: the governed water layer is the wells layer.
    ['LU-WATER-001', 'WATER', 'Brunnar'],
    ['LU-EBH-001', 'EBH', 'Potentiellt förorenat område (EBH)'],
    ['LU-PROTECTED-001', 'PROTECTED_AREA', 'Skyddad natur'],
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
    ['NOT_CHECKED', 'Ej kontrollerad'],
  ] as const)('maps risk_level %s to attention label %s', (risk_level, attentionLabel) => {
    const presentation = presentLuFinding({ rule_id: 'LU-WATER-001', risk_level });
    expect(presentation.attentionLabel).toBe(attentionLabel);
  });
  it('DEMO M2a: the finding summary comes from the rule definition, never the misnaming engine text', () => {
    expect(presentLuFindingSummary({ rule_id: 'LU-WATER-001', risk_level: 'MEDIUM', explanation: 'Närhet till vatten kräver analys' })).toBe(
      'Brunnar finns inom sökradien.',
    );
    expect(presentLuFindingSummary({ rule_id: 'LU-NATURA2000-001', risk_level: 'NOT_CHECKED', explanation: 'x' })).toBe(
      'Natura 2000: kontrollen kunde inte göras – källan var otillgänglig.',
    );
    expect(presentLuFindingSummary({ rule_id: 'LU-DOC-BESLUT-001', risk_level: 'MEDIUM', explanation: 'Tidigare beslut föreligger' })).toBe(
      'Tidigare beslut föreligger',
    );
  });

  it('DEMO M2b: an unknown risk level for a known layer rule is never presented as a hit', () => {
    const summary = presentLuFindingSummary({ rule_id: 'LU-WATER-001', risk_level: 'SOMETHING_NEW', explanation: 'x' });
    expect(summary).toBe('Fyndets nivå kunde inte tolkas – se teknisk information.');
    expect(summary).not.toMatch(/finns inom sökradien/);
    expect(presentLuFinding({ rule_id: 'LU-WATER-001', risk_level: 'SOMETHING_NEW' }).attentionLabel).toBe('Okänd nivå');
  });
});