import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/repositories/legalSourceRepository', () => ({
  upsertLegalSourceWithMatrix: vi.fn(),
}));

import { upsertLegalSourceWithMatrix } from '../../server/repositories/legalSourceRepository';
import { FOUNDATION_LEGAL_SOURCES } from '../../server/modules/legal/catalogs/foundationLegalSources';
import { syncFoundationLegalSources } from '../../server/modules/legal/services/foundationLegalSourceSyncService';

describe('foundationLegalSourceSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs every curated foundation legal source into LegalSourceRecord', async () => {
    vi.mocked(upsertLegalSourceWithMatrix).mockImplementation(async (input: any) => ({
      record: {
        id: `legal-${input.externalId}`,
        title: input.title,
      },
      matrixRow: null,
    }));

    const result = await syncFoundationLegalSources();

    expect(result.processed).toBe(FOUNDATION_LEGAL_SOURCES.length);
    expect(result.records).toHaveLength(FOUNDATION_LEGAL_SOURCES.length);
    expect(upsertLegalSourceWithMatrix).toHaveBeenCalledTimes(FOUNDATION_LEGAL_SOURCES.length);
    expect(vi.mocked(upsertLegalSourceWithMatrix).mock.calls[0]?.[0]).toMatchObject({
      sourceSystem: 'SFS',
      externalId: 'SFS:1998:808',
      sourceType: 'FOUNDATION_LAW',
      legalArea: 'Miljö',
    });
  });
});
