/**
 * One-shot WORM promotion namespace migration.
 *
 *   npx tsx scripts/artifact/migrate-promotion-worm-v1.ts --root <artifact-dir> [--dry-run]
 *
 * Do NOT use ArtifactMigrationRegistry.migrateToLatest for bulk promotion/* —
 * that would pull rejected v2 candidates into the approved-only promotion/ namespace.
 */
import path from 'node:path';
import { FileArtifactStore } from '../../server/artifact/FileArtifactStore';
import { migratePromotionWormV1 } from '../../server/artifact/migratePromotionWormV1';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rootIdx = args.indexOf('--root');
  const rootArg = rootIdx >= 0 ? args[rootIdx + 1] : undefined;
  const root = path.resolve(rootArg ?? path.join(process.cwd(), 'tmp-artifacts'));

  console.log(`WORM migration root=${root} dryRun=${dryRun}`);
  const store = new FileArtifactStore(root);
  const summary = await migratePromotionWormV1(store, { dryRun });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
