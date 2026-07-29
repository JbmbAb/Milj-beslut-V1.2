/**
 * Build an offline third-party audit bundle from a Mimers root (cas/ + ledger/).
 *
 *   npm run mimers:audit-bundle -- --root ./tmp-mimers --out ./tmp-artifacts/audit-bundle
 *
 * Without --root: seeds a demo root, verifies, and packages it (for dry-run / CI smoke).
 */
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EvolutionLedger,
  FileCASRepository,
  FileEventLog,
  ManifestBuilder,
} from '@miljobeslut/mimers-brunn-core';
import { externalVerifyMimersRoot } from './prove-external-verify';

export type AuditBundleReport = {
  readonly ok: boolean;
  readonly outDir: string;
  readonly sourceRoot: string;
  readonly seeded: boolean;
  readonly verifyOk: boolean;
  readonly events: number;
  readonly errors: readonly string[];
};

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

async function seedDemoRoot(root: string): Promise<void> {
  const cas = new FileCASRepository(path.join(root, 'cas'), { durabilityMode: 'none' });
  await cas.initialize();
  const log = new FileEventLog(path.join(root, 'ledger'), {
    durabilityMode: 'none',
    maxEventsPerSegment: 2,
  });
  await log.initialize();
  const ledger = new EvolutionLedger(cas, log);
  for (let i = 0; i < 4; i += 1) {
    const { manifest } = await new ManifestBuilder(cas)
      .pipeline({ id: `audit-${i}` })
      .policy({ i })
      .runtime({ auditBundle: true })
      .metrics({ latencyMs: i, costSek: 0, qualityScore: 1, errorRate: 0 })
      .build();
    await ledger.commitPromotion(manifest, [], i + 1, { metadataName: `audit-${i}` });
  }
}

export async function buildAuditBundle(options?: {
  readonly root?: string;
  readonly outDir?: string;
}): Promise<AuditBundleReport> {
  const errors: string[] = [];
  const seeded = !options?.root && !argValue('--root');
  const work = await mkdtemp(path.join(os.tmpdir(), 'mimers-audit-src-'));
  let sourceRoot = options?.root ?? argValue('--root') ?? path.join(work, 'demo-root');
  sourceRoot = path.resolve(sourceRoot);

  const outDir = path.resolve(
    options?.outDir ?? argValue('--out') ?? path.join('tmp-artifacts', 'mimers-audit-bundle'),
  );

  try {
    if (seeded) {
      await mkdir(sourceRoot, { recursive: true });
      await seedDemoRoot(sourceRoot);
    }

    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    await cp(path.join(sourceRoot, 'cas'), path.join(outDir, 'cas'), { recursive: true });
    await cp(path.join(sourceRoot, 'ledger'), path.join(outDir, 'ledger'), { recursive: true });

    const verify = await externalVerifyMimersRoot(outDir);
    if (!verify.ok) errors.push(...verify.errors);

    await writeFile(
      path.join(outDir, 'VERIFY_REPORT.json'),
      `${JSON.stringify(verify, null, 2)}\n`,
      'utf-8',
    );

    await writeFile(
      path.join(outDir, 'AUDIT_README.md'),
      `# Mimers Brunn v9 — audit bundle

Generated: ${new Date().toISOString()}
Source root: \`${sourceRoot}\`
Seeded demo: ${seeded}

## Contents

- \`cas/\` — content-addressed objects
- \`ledger/\` — append-only segments + checkpoints
- \`VERIFY_REPORT.json\` — machine verification from packaging time
- This README

## Auditor steps

1. Do **not** require ArtifactStore, evolve DB, or cloud credentials.
2. From the repository checkout:

\`\`\`bash
npm ci
npm run mimers:verify -- --root ${outDir.replace(/\\/g, '/')}
\`\`\`

3. Compare your report with \`VERIFY_REPORT.json\` (ok, events, L0/L1/L2, checkpointChainOk).
4. Complete [external-audit-checklist](../../docs/ops/mimers-brunn-v9-external-audit-checklist.md) sign-off form.

## Pass bar

\`ok: true\` and identical event count / CLEAN levels without mutating storage.
`,
      'utf-8',
    );

    await writeFile(
      path.join(outDir, 'BUNDLE_MANIFEST.json'),
      `${JSON.stringify(
        {
          kind: 'mimers-audit-bundle-v1',
          createdAt: new Date().toISOString(),
          sourceRoot,
          seeded,
          verify,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    );

    return {
      ok: errors.length === 0 && verify.ok,
      outDir,
      sourceRoot,
      seeded,
      verifyOk: verify.ok,
      events: verify.events,
      errors,
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const report = await buildAuditBundle();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

const isDirect =
  process.argv[1]?.includes('build-audit-bundle') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('build-audit-bundle.ts');
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
