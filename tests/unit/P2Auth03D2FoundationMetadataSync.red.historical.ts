import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/repositories/legalSourceRepository', () => ({
  upsertLegalSourceWithMatrix: vi.fn(),
}));

import { upsertLegalSourceWithMatrix } from '../../server/repositories/legalSourceRepository';
import { syncFoundationLegalSources } from '../../server/modules/legal/services/foundationLegalSourceSyncService';

describe('P2-AUTH-03D2 historical red proof - parallel foundation metadata authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P2-AUTH-03D2 VIOLATED: an unverified caller-supplied source reaches permanent metadata write', async () => {
    vi.mocked(upsertLegalSourceWithMatrix).mockResolvedValue({
      record: { id: 'legal-forged', title: 'Forged foundation source' } as never,
      matrixRow: null,
    });

    await syncFoundationLegalSources([
      {
        id: 'foundation.forged',
        externalId: 'SFS:9999:999',
        title: 'Forged foundation source',
        shortTitle: 'Forged',
        instrumentType: 'LAW',
        authorityName: 'Self-declared authority',
        authorityType: 'Statlig',
        legalArea: 'Miljo',
        sourceUrl: 'https://attacker.invalid/forged-law',
        summary: 'Caller-controlled metadata.',
        keywords: ['forged'],
      },
    ]);

    const writes = vi.mocked(upsertLegalSourceWithMatrix).mock.calls;
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toMatchObject({
      authorityName: 'Self-declared authority',
      sourceUrl: 'https://attacker.invalid/forged-law',
    });

    throw new Error(
      'P2-AUTH-03D2 VIOLATED: metadata_writes=1; verified_registry_consulted=false; ' +
        'caller_supplied_authority_accepted=true',
    );
  });
});
