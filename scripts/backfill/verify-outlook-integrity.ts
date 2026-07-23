/**
 * Stage 3 Outlook integrity smoke + optional backfill kickoff.
 *
 * Default: verify helpers (SHA-256 / DLQ / soft-delete) without long ingest.
 * Full backfill (may take >5 min):
 *   npx tsx scripts/backfill/verify-outlook-integrity.ts --run-all
 */
import { loadEnvFile } from '../../server/loadEnv';

loadEnvFile();
loadEnvFile('.env.local', { overrideExisting: true });

const { sha256, listDlqAttachments } = await import('../../server/services/outlookIngestionService');
const { prisma } = await import('../../server/db/prisma');
const { spawn } = await import('node:child_process');
const pathMod = await import('node:path');

async function verifyLocalHelpers() {
  const hash = sha256(Buffer.from('integrity-probe'));
  if (hash.length !== 64) throw new Error('SHA-256 length invalid');

  const dlq = await listDlqAttachments(5);
  console.log(`[outlook-integrity] SHA-256 ok; DLQ sample size=${dlq.length}`);

  const softDeleted = await prisma.emailMessage.count({
    where: { status: 'SOFT_DELETED' },
  });
  const complete = await prisma.emailMessage.count({
    where: { status: 'COMPLETE' },
  });
  const attachments = await prisma.outlookAttachment.count();
  console.log(
    `[outlook-integrity] emails softDeleted=${softDeleted} complete=${complete} attachments=${attachments}`,
  );
}

function runAllBackfill(): Promise<number> {
  return new Promise((resolve, reject) => {
    const script = pathMod.join(process.cwd(), 'scripts/backfill/run-outlook-ingest-pipeline.ts');
    const child = spawn(process.execPath, ['--import', 'tsx', script, '--all'], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  await verifyLocalHelpers();

  if (process.argv.includes('--run-all')) {
    console.log('[outlook-integrity] Starting ingestion backfill --all ...');
    const code = await runAllBackfill();
    if (code !== 0) {
      console.error(`[outlook-integrity] backfill exited with ${code}`);
      process.exit(code);
    }
    console.log('[outlook-integrity] backfill --all finished');
  } else {
    console.log('[outlook-integrity] Skipping --all (pass --run-all to ingest remaining mail)');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
