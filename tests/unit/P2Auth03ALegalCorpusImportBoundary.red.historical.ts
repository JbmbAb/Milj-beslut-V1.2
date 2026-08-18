import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { legalCorpusUpsert, legalSourceUpsert, judgmentUpsert } = vi.hoisted(() => ({
  legalCorpusUpsert: vi.fn(async (input: unknown) => input),
  legalSourceUpsert: vi.fn(async () => ({ id: 'legacy-source' })),
  judgmentUpsert: vi.fn(async () => ({ id: 'legacy-judgment' })),
}));

vi.mock('../../server/repositories/legalSourceRepository', () => ({
  upsertLegalSourceRecord: legalSourceUpsert,
}));

vi.mock('../../server/repositories/judgmentRepository', () => ({
  upsertJudgment: judgmentUpsert,
}));

vi.mock('../../server/db/prisma', () => ({
  prisma: { legalCorpusRecord: { upsert: legalCorpusUpsert } },
}));

import { importDownloadedLegalCorpus } from '../../server/modules/legal/services/legalCorpusImportService';

describe('P2-AUTH-03A legacy legal corpus import boundary', () => {
  let rootDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p2-auth-03a-red-'));

    const sourceDir = path.join(rootDir, 'legal', 'foundation-sources');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, 'manifest.json'),
      JSON.stringify({
        downloads: [
          {
            externalId: 'SFS:1998:808',
            title: 'Miljobalken (1998:808)',
            sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=1998:808',
            contentType: 'text/html',
            savedAs: 'sfs-1998-808.html',
          },
        ],
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(sourceDir, 'sfs-1998-808.html'),
      '<html><body>Legacy downloaded legal material.</body></html>',
      'utf8',
    );
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('rejects permanent writes when governed corpus admission is absent', async () => {
    await importDownloadedLegalCorpus({ rootDir, extractPdfText: false });

    const evidence = {
      judgment_writes: judgmentUpsert.mock.calls.length,
      legal_source_writes: legalSourceUpsert.mock.calls.length,
      legal_corpus_writes: legalCorpusUpsert.mock.calls.length,
      corpus_import_gate_used: false,
      attestation_supplied: false,
    };

    expect(
      evidence.judgment_writes + evidence.legal_source_writes + evidence.legal_corpus_writes,
      `P2-AUTH-03A VIOLATED\n${JSON.stringify(evidence, null, 2)}`,
    ).toBe(0);
  });
});
