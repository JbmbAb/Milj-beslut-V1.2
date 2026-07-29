/**
 * One-shot ArtifactStore → Mimers CAS migration (ADR-042).
 * Do NOT run at server startup.
 *
 *   npm run mimers:migrate-cas -- --artifacts <dir> --mimers <dir> [--dry-run]
 */
import path from 'node:path';
import { FileArtifactStore } from '../../server/artifact/FileArtifactStore';
import {
  createPersistentMimersBackend,
  migrateArtifactStoreToMimersCas,
} from '../../server/mimers';

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const artifacts = path.resolve(argValue(args, '--artifacts') ?? path.join(process.cwd(), 'tmp-artifacts'));
  const mimers = path.resolve(argValue(args, '--mimers') ?? path.join(process.cwd(), 'tmp-mimers'));

  console.log(`Mimers CAS migration artifacts=${artifacts} mimers=${mimers} dryRun=${dryRun}`);
  const store = new FileArtifactStore(artifacts);
  const { backend } = await createPersistentMimersBackend(mimers, {
    durabilityMode: process.platform === 'win32' ? 'best-effort' : 'strict',
  });
  const result = await migrateArtifactStoreToMimersCas(store, backend, { dryRun });
  console.log(JSON.stringify(result, null, 2));
  if (result.report.failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
