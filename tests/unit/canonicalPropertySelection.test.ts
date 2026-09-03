import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRaw = vi.hoisted(() => vi.fn());

vi.mock('../../server/db/prisma', () => ({
  prisma: { $queryRaw: queryRaw },
}));

import {
  resolveCanonicalPropertySelection,
  searchCanonicalPropertyCandidates,
} from '../../server/modules/property/canonicalPropertySelection';

const user = {
  id: 'user-1',
  organisationId: 'org-1',
  bankidId: 'bankid-1',
  role: 'CONSULTANT' as const,
};

describe('LU canonical property selection', () => {
  beforeEach(() => queryRaw.mockReset());

  it('returns multiple canonical candidates for discovery without selecting one as authority', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        source_key: 'source-a',
        source_dataset: 'lm_fastighetsytor',
        designation: 'FALKENBERG ULLARED 2:215',
        municipality_code: '1382',
        municipality_name: 'FALKENBERG',
        county_code: '13',
        match_kind: 'fuzzy',
      },
      {
        source_key: 'source-b',
        source_dataset: 'lm_fastighetsytor',
        designation: 'FALKENBERG ULLARED 2:216',
        municipality_code: '1382',
        municipality_name: 'FALKENBERG',
        county_code: '13',
        match_kind: 'fuzzy',
      },
    ]);

    await expect(searchCanonicalPropertyCandidates({ query: 'Ullared 2:215' }, user)).resolves.toEqual([
      expect.objectContaining({ sourceKey: 'source-a', designation: 'FALKENBERG ULLARED 2:215' }),
      expect.objectContaining({ sourceKey: 'source-b', designation: 'FALKENBERG ULLARED 2:216' }),
    ]);
  });

  it('re-resolves the selected source identity and rejects a mismatched designation', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        source_key: 'source-a',
        source_dataset: 'lm_fastighetsytor',
        designation: 'FALKENBERG ULLARED 2:215',
        municipality_code: '1382',
        municipality_name: 'FALKENBERG',
        county_code: '13',
      },
    ]);

    await expect(
      resolveCanonicalPropertySelection({
        sourceKey: 'source-a',
        sourceDataset: 'lm_fastighetsytor',
        designation: 'FALKENBERG ULLARED 2:999',
      }),
    ).rejects.toThrow('does not match the selected canonical property');
  });
});
