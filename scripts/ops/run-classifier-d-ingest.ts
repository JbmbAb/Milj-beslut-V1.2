/**
 * SAN-2026-014 — Classify + empty D_ingest_arkiv via Mimer ClassifierAgent.
 *
 * Inventory → Fingerprint → Classifier → Confidence → Decision
 *   high  (>0.98) → AUTO_MOVE (+ ClassifierArtifact + SAN MOVE)
 *   medium (0.75–0.98) → HITL matrix (no move)
 *   low   (<0.75) → quarantine/review
 *
 *   npx tsx scripts/ops/run-classifier-d-ingest.ts
 *   npx tsx scripts/ops/run-classifier-d-ingest.ts --execute
 *   npx tsx scripts/ops/run-classifier-d-ingest.ts --execute --approve-hitl=curated-downloads,foundation-sources
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  classifyFingerprint,
  fingerprintPath,
  type ClassifierArtifact,
} from '../../packages/mimers-brunn-core/src/classifier/index.ts';

const DRY = !process.argv.includes('--execute');
const approveArg = process.argv.find((a) => a.startsWith('--approve-hitl='));
const APPROVE_HITL = new Set(
  approveArg
    ? approveArg
        .slice('--approve-hitl='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [],
);

const MASTER =
  process.env.GEO_MASTER_ARCHIVE ??
  'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const INGEST = path.join(
  MASTER,
  'Documents',
  'Sources',
  '_migration_from_D',
  '2026-06-19',
  'D_ingest_arkiv',
);
const LEGAL = path.join(INGEST, 'legal');
const QROOT = path.join(MASTER, '_quarantine', 'SAN-2026-014-classifier-low');
const OPS_DIR = path.join(MASTER, '_ops', 'sanitation');
const REPO_OPS = path.join(process.cwd(), 'storage', 'manifests', 'sanitation');
const CLS_DIR = path.join(REPO_OPS, 'classifier');
const OP_BATCH = 'SAN-2026-014';

function writeJson(fp: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function writeDual(name: string, obj: unknown): void {
  writeJson(path.join(OPS_DIR, name), obj);
  writeJson(path.join(REPO_OPS, name), obj);
}

function moveDir(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) throw new Error(`destination exists: ${dest}`);
  try {
    fs.renameSync(src, dest);
  } catch {
    execFileSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `Move-Item -LiteralPath '${src.replace(/'/g, "''")}' -Destination '${dest.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: 'inherit' },
    );
  }
}

function listChildDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function main(): void {
  console.log(`${DRY ? 'DRY-RUN' : 'EXECUTE'} ${OP_BATCH} classifier against D_ingest_arkiv`);

  if (!fs.existsSync(LEGAL)) {
    console.error(`Missing ingest root: ${LEGAL}`);
    process.exit(1);
  }

  const children = listChildDirs(LEGAL);
  const artifacts: ClassifierArtifact[] = [];
  const results: Array<Record<string, unknown>> = [];
  let opSeq = 0;
  let autoMoved = 0;
  let hitl = 0;
  let quarantined = 0;
  let errors = 0;

  for (const name of children) {
    const abs = path.join(LEGAL, name);
    const fingerprint = fingerprintPath(abs, MASTER);
    opSeq += 1;
    const artifactId = `CLS-2026-014-${String(opSeq).padStart(3, '0')}`;
    const { artifact, matched_rule_id } = classifyFingerprint(fingerprint, {
      artifact_id: artifactId,
      classifier_id: 'mimer.classifier.v1',
    });
    artifacts.push(artifact);
    writeJson(path.join(CLS_DIR, `${artifactId}.json`), artifact);

    const wantHitlApprove = APPROVE_HITL.has(name) || APPROVE_HITL.has(artifact.predicted_dataset ?? '');
    let effectiveAction = artifact.action;
    if (artifact.action === 'HITL_REVIEW' && wantHitlApprove && artifact.predicted_target) {
      effectiveAction = 'AUTO_MOVE';
    }

    if (effectiveAction === 'HITL_REVIEW') {
      hitl += 1;
      results.push({
        status: 'hitl',
        basename: name,
        artifact_id: artifactId,
        matched_rule_id,
        confidence: artifact.confidence,
        predicted_provider: artifact.predicted_provider,
        predicted_target: artifact.predicted_target,
        reasoning: artifact.reasoning,
      });
      continue;
    }

    if (effectiveAction === 'QUARANTINE_REVIEW' || !artifact.predicted_target) {
      const dest = path.join(QROOT, name);
      const destRel = path.relative(MASTER, dest).replace(/\\/g, '/');
      try {
        if (!DRY) moveDir(abs, dest);
        quarantined += 1;
        const sanId = `${OP_BATCH}-Q-${String(quarantined).padStart(3, '0')}`;
        const san = {
          schema_version: '1.0',
          operation_id: sanId,
          action: 'MOVE',
          reason: 'legacy_migration',
          source: fingerprint.rel_path,
          target: destRel,
          provider: artifact.predicted_provider ?? 'UNKNOWN',
          dataset: artifact.predicted_dataset ?? name,
          files: fingerprint.file_count,
          old_hashes: [],
          new_hashes: [],
          classification: 'unknown',
          approved_by: 'JbmbAb',
          created_at: new Date().toISOString(),
          closed_at: DRY ? undefined : new Date().toISOString(),
          status: DRY ? 'planned' : 'completed',
          notes: `Classifier low-confidence quarantine. ${artifact.reasoning}`,
          related_operation_ids: [artifactId],
          evidence: { classifier_artifact_id: artifactId, confidence: artifact.confidence },
        };
        writeDual(`${sanId}.json`, san);
        results.push({
          status: DRY ? 'planned_quarantine' : 'quarantined',
          basename: name,
          artifact_id: artifactId,
          target: destRel,
          confidence: artifact.confidence,
        });
      } catch (err) {
        errors += 1;
        results.push({
          status: 'error',
          basename: name,
          note: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    // AUTO_MOVE
    const dest = path.join(MASTER, artifact.predicted_target.replace(/\//g, path.sep), name);
    // predicted_target already ends with dataset folder name in rules — avoid double basename
    const destFinal = artifact.predicted_target.endsWith(name)
      ? path.join(MASTER, artifact.predicted_target.replace(/\//g, path.sep))
      : dest;
    const destRel = path.relative(MASTER, destFinal).replace(/\\/g, '/');

    try {
      if (!DRY) moveDir(abs, destFinal);
      autoMoved += 1;
      const sanId = `${OP_BATCH}-${String(autoMoved).padStart(3, '0')}`;
      const san = {
        schema_version: '1.0',
        operation_id: sanId,
        action: 'MOVE',
        reason: 'legacy_migration',
        source: fingerprint.rel_path,
        target: destRel,
        provider: artifact.predicted_provider,
        dataset: artifact.predicted_dataset,
        files: fingerprint.file_count,
        old_hashes: [],
        new_hashes: [],
        classification: 'canonical',
        approved_by: 'JbmbAb',
        created_at: new Date().toISOString(),
        closed_at: DRY ? undefined : new Date().toISOString(),
        status: DRY ? 'planned' : 'completed',
        notes: `Classifier AUTO_MOVE (confidence=${artifact.confidence}). ${artifact.reasoning}`,
        related_operation_ids: [artifactId],
        evidence: {
          classifier_artifact_id: artifactId,
          matched_patterns: artifact.matched_patterns,
          confidence: artifact.confidence,
          hitl_approved: wantHitlApprove,
        },
      };
      writeDual(`${sanId}.json`, san);
      // link classifier → SAN
      writeJson(path.join(CLS_DIR, `${artifactId}.json`), {
        ...artifact,
        related_operation_ids: [sanId],
        action: 'AUTO_MOVE',
      });
      results.push({
        status: DRY ? 'planned_auto_move' : 'auto_moved',
        basename: name,
        artifact_id: artifactId,
        san_id: sanId,
        target: destRel,
        confidence: artifact.confidence,
        provider: artifact.predicted_provider,
      });
    } catch (err) {
      errors += 1;
      results.push({
        status: 'error',
        basename: name,
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Attempt to remove empty parents after execute
  let emptied = false;
  if (!DRY) {
    try {
      if (fs.existsSync(LEGAL) && listChildDirs(LEGAL).length === 0) {
        // remove leftover files in legal/
        for (const e of fs.readdirSync(LEGAL)) {
          fs.rmSync(path.join(LEGAL, e), { recursive: true, force: true });
        }
        fs.rmdirSync(LEGAL);
      }
      if (fs.existsSync(INGEST) && fs.readdirSync(INGEST).length === 0) {
        fs.rmdirSync(INGEST);
        emptied = true;
      } else if (fs.existsSync(INGEST)) {
        emptied = listChildDirs(INGEST).length === 0 && fs.readdirSync(INGEST).length === 0;
      }
    } catch (err) {
      console.warn('cleanup parents:', err instanceof Error ? err.message : err);
    }
  }

  const batch = {
    schema_version: '1.0',
    operation_id: OP_BATCH,
    action: 'CLASSIFY',
    reason: 'legacy_migration',
    source: 'Documents/Sources/_migration_from_D/2026-06-19/D_ingest_arkiv',
    provider: 'classifier',
    approved_by: 'JbmbAb',
    created_at: new Date().toISOString(),
    closed_at: DRY || hitl > 0 ? undefined : new Date().toISOString(),
    status: DRY ? 'planned' : errors ? 'in_progress' : hitl > 0 ? 'in_progress' : 'completed',
    notes:
      'P4 ClassifierAgent run. High→auto move, medium→HITL, low→quarantine. Manual archive moves frozen thereafter.',
    evidence: {
      dry_run: DRY,
      children: children.length,
      auto_moved: autoMoved,
      hitl,
      quarantined,
      errors,
      emptied_ingest: emptied,
      approve_hitl: [...APPROVE_HITL],
      classifier_dir: path.relative(process.cwd(), CLS_DIR).replace(/\\/g, '/'),
      results,
    },
  };
  writeDual(`${OP_BATCH}.json`, batch);
  writeDual(`${OP_BATCH}-hitl-matrix.json`, {
    generated_at: new Date().toISOString(),
    how_to_approve:
      'npx tsx scripts/ops/run-classifier-d-ingest.ts --execute --approve-hitl=<dataset>,...',
    pending: results.filter((r) => r.status === 'hitl'),
  });

  console.log(
    JSON.stringify(
      {
        dry_run: DRY,
        children: children.length,
        auto_moved: autoMoved,
        hitl,
        quarantined,
        errors,
        emptied_ingest: emptied,
        results,
      },
      null,
      2,
    ),
  );

  if (errors > 0) process.exit(1);
}

main();
