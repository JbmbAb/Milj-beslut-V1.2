import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const TARGET = path.resolve(
  process.cwd(),
  'scripts/import/seed-core-legal-sfs.ts',
);

describe('P2-AUTH-02 direct legal corpus write capability', () => {
  it('rejects a CLI that combines independent source acquisition with corpus/archive writes', () => {
    const source = fs.readFileSync(TARGET, 'utf8');
    const evidence = {
      directly_executable: /\bmain\(\)\s*\n?\s*\.catch\(/.test(source),
      bare_network_fetch: /\bfetch\s*\(/.test(source),
      hardcoded_source_authority: /https:\/\/data\.riksdagen\.se\//.test(source),
      live_write_switch: /ALLOW_LIVE_SEED/.test(source),
      permanent_corpus_write: /legalCorpusRecord\.upsert\s*\(/.test(source),
      custom_archive_or_manifest_write:
        /archives[',"\s]+raw/.test(source) && /writeFileSync\s*\(/.test(source),
      verified_source_registry_consulted: /loadVerifiedSourceRegistry\s*\(/.test(source),
      canonical_import_gate_used: /CorpusImportGate/.test(source),
    };

    const violation =
      evidence.directly_executable &&
      evidence.bare_network_fetch &&
      evidence.hardcoded_source_authority &&
      (evidence.permanent_corpus_write || evidence.custom_archive_or_manifest_write) &&
      !evidence.verified_source_registry_consulted &&
      !evidence.canonical_import_gate_used;

    expect(
      violation,
      `P2-AUTH-02 VIOLATED\n${JSON.stringify(evidence, null, 2)}`,
    ).toBe(false);
  });
});
