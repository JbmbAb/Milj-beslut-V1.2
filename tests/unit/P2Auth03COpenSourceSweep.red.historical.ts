import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/repositories/legalSourceRepository', () => ({
  upsertLegalSourceRecord: vi.fn(),
}));
vi.mock('../../server/repositories/judgmentRepository', () => ({
  upsertJudgment: vi.fn(),
}));
vi.mock('../../server/db/prisma', () => ({
  prisma: { legalCorpusRecord: { upsert: vi.fn() } },
}));

import { collectDownloadedLegalCorpus } from '../../server/modules/legal/services/legalCorpusImportService';
import { downloadOpenSourceSweep } from '../../server/services/openSourceSweepDownloadService';

describe('P2-AUTH-03C openSourceSweep authority contamination', () => {
  let rootDir: string | undefined;

  afterEach(async () => {
    if (rootDir) {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects ungoverned acquisition whose manifest is consumable as legal corpus material', async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p2-auth-03c-red-'));
    const outputDir = path.join(rootDir, 'open-source-sweep');
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'legacy open source payload',
    }));

    const result = await downloadOpenSourceSweep({
      outputDir,
      fetchImpl,
      now: () => new Date('2026-08-14T00:00:00.000Z'),
    });
    const collected = await collectDownloadedLegalCorpus({
      rootDir,
      extractPdfText: false,
    });
    const sweepRecords = collected.filter((record) => record.sourceFamily === 'OPEN_SOURCE_SWEEP');
    const evidence = {
      hardcoded_targets_attempted: result.attempted,
      network_calls: fetchImpl.mock.calls.length,
      persistent_payloads_written: result.downloaded,
      provenance_like_manifest_exists: await fileExists(result.manifestPath),
      structurally_consumable_legal_records: sweepRecords.length,
      verified_source_registry_consulted: false,
      canonical_admission_used: false,
    };
    const violation =
      evidence.network_calls > 0 &&
      evidence.persistent_payloads_written > 0 &&
      evidence.provenance_like_manifest_exists &&
      evidence.structurally_consumable_legal_records > 0 &&
      !evidence.verified_source_registry_consulted &&
      !evidence.canonical_admission_used;

    expect(
      violation,
      `P2-AUTH-03C VIOLATED\n${JSON.stringify(evidence, null, 2)}`,
    ).toBe(false);
  });
});

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
