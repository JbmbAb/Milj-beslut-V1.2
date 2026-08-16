import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { approveSourceRegistryEntry } from '../src/SourceApproval';
import {
  getSourceRegistrySigningKeyFromEnv,
  loadVerifiedSourceRegistry,
  type SourceRegistryArtifact,
} from '../src/SourceRegistry';

/**
 * GOVERNOR approval CLI.
 *
 *   npx tsx packages/mps-data-governance/scripts/approve-source.ts \
 *     --in  source-registry/drafts/puh-mmod-unsigned.json \
 *     --out source-registry/drafts/puh-mmod-approved.json \
 *     --approver "<actor id>"
 *
 * The signing key is read from the environment ONLY:
 *
 *   SOURCE_REGISTRY_SIGNING_KEY_ID
 *   SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM
 *   SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM
 *
 * ⚠️ There is deliberately NO --private-key flag. A key passed on the command line lands in
 * shell history and in the process list, where any other user on the machine can read it; a
 * signing key that has been in `ps` output is compromised regardless of what it later signs.
 *
 * The output is written to a NEW file. This tool never edits the production registry —
 * installing an approved source is a separate, visible act.
 *
 * @see ../src/SourceApproval.ts
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Refused explicitly rather than ignored: someone who passes a key on the command line has
  // already exposed it, and should be told so rather than have the flag silently do nothing.
  for (const forbidden of ['private-key', 'privateKey', 'key', 'pem']) {
    if (process.argv.includes(`--${forbidden}`)) {
      fail(
        `--${forbidden} is not accepted. The signing key is read from ` +
          'SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM. A key given on the command line is visible ' +
          'in shell history and in the process list, and must be considered compromised.',
      );
    }
  }

  const inPath = arg('in');
  const outPath = arg('out');
  const approver = arg('approver');

  if (!inPath || !outPath || !approver) {
    fail('Usage: --in <draft.json> --out <approved.json> --approver "<actor id>"');
  }

  const signing = getSourceRegistrySigningKeyFromEnv();

  const draft = JSON.parse(readFileSync(resolve(inPath), 'utf-8')) as SourceRegistryArtifact[];
  if (!Array.isArray(draft) || draft.length === 0) {
    fail(`${inPath} must be a non-empty JSON array of SOURCE_REGISTRY_ENTRY objects.`);
  }

  console.log(`\n🔑 Signing key: ${signing.keyId}`);
  console.log(`👤 Approver   : ${approver}`);
  console.log(`📄 Draft      : ${inPath}  (${draft.length} entr${draft.length === 1 ? 'y' : 'ies'})\n`);

  const approved: SourceRegistryArtifact[] = [];
  for (const entry of draft) {
    const result = await approveSourceRegistryEntry({
      entry,
      approver_actor_id: approver,
      signing,
    });
    approved.push(result);
    console.log(`   ✅ ${result.source_id}`);
    console.log(`      content hash : ${result.approval_attestation.subjectDigest}`);
    console.log(`      signer       : ${result.approval_attestation.signer}`);
  }

  writeFileSync(resolve(outPath), `${JSON.stringify(approved, null, 2)}\n`, 'utf-8');

  // Load the written FILE through the production loader. Verifying the in-memory object would
  // not prove that what landed on disk is loadable — serialization is part of the path.
  const registry = await loadVerifiedSourceRegistry({ registryPath: resolve(outPath), signing });

  console.log(`\n📝 Written   : ${outPath}`);
  console.log(`🔍 Reloaded  : ${registry.sources.length} verified source(s) via loadVerifiedSourceRegistry()`);
  for (const source of registry.sources) {
    console.log(`   • ${source.sourceId}  adapter=${source.adapter}  domains=${source.allowedDomains.join(', ')}`);
  }

  console.log(
    '\n⚠️  This file is NOT yet the production registry. Installing it at ' +
      'SOURCE_REGISTRY_ARTIFACT_PATH is a separate, deliberate step.\n',
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
