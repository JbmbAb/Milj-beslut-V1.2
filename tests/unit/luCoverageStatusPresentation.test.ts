import { describe, expect, it } from 'vitest';
import { presentLuCoverageStatus } from '../../components/app/lu/luCoverageStatusPresentation';

describe('LU-UNKNOWN-MISSING-DISPLAY-V1', () => {
  it.each([
    ['ok', 'Inga avvikelser identifierade i denna källa'],
    ['degraded', 'Ofullständigt underlag'],
    ['unavailable', 'Källan är otillgänglig'],
  ] as const)('maps status %s to label %s', (status, label) => {
    expect(presentLuCoverageStatus(status).label).toBe(label);
  });

  it('maps an unrecognized status to an explicit unknown label, never silently to the ok label', () => {
    expect(presentLuCoverageStatus('some-future-status').label).toBe('Okänd status');
    expect(presentLuCoverageStatus('').label).toBe('Okänd status');
  });
});
