import { describe, expect, it } from 'vitest';
import { presentLuCoverageStatus, presentLuGovernedLayerCheck } from '../../components/app/lu/luCoverageStatusPresentation';

describe('LU-UNKNOWN-MISSING-DISPLAY-V1', () => {
  it.each([
    // DEMO M1a / U12: `ok` on a legacy/ungoverned source means only "the source answered"; it was
    // previously labelled 'Inga avvikelser identifierade i denna källa', which read as a checked,
    // no-hit result. It must never say that.
    ['ok', 'Källan svarade – inte kontrollerad i den styrda bedömningen'],
    ['degraded', 'Ofullständigt underlag'],
    ['unavailable', 'Källan är otillgänglig'],
  ] as const)('maps status %s to label %s', (status, label) => {
    expect(presentLuCoverageStatus(status).label).toBe(label);
  });

  it('DEMO M1a / U12: no legacy source status ever renders as "inga avvikelser" or as "kontrollerat"', () => {
    for (const status of ['ok', 'degraded', 'unavailable', 'x']) {
      const { label } = presentLuCoverageStatus(status);
      expect(label).not.toMatch(/Inga avvikelser/i);
      expect(label).not.toMatch(/^Kontrollerat/);
    }
  });

  it('maps an unrecognized status to an explicit unknown label, never silently to the ok label', () => {
    expect(presentLuCoverageStatus('some-future-status').label).toBe('Okänd status');
    expect(presentLuCoverageStatus('').label).toBe('Okänd status');
  });
});

describe('DEMO M1a / U12: governed per-layer check labels', () => {
  it.each([
    ['CHECKED_NO_HIT', 'Kontrollerat – ingen träff'],
    ['CHECKED_HIT', 'Kontrollerat – träff (se fynd)'],
    ['NOT_CHECKED', 'Inte kontrollerat'],
    ['SOMETHING_NEW', 'Okänd status'],
  ] as const)('%s -> %s', (status, label) => {
    expect(presentLuGovernedLayerCheck({ layer: 'protected_area', status }).label).toBe(label);
  });

  it('names governed layers in Swedish and falls back to the raw layer id', () => {
    expect(presentLuGovernedLayerCheck({ layer: 'protected_area', status: 'NOT_CHECKED' }).name).toBe('Skyddade naturområden');
    expect(presentLuGovernedLayerCheck({ layer: 'new_layer', status: 'NOT_CHECKED' }).name).toBe('new_layer');
  });
});
