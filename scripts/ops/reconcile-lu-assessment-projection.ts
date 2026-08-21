/**
 * P3-LU-ASSESSMENT-PROJECTION-RELIABILITY-01.
 *
 * Operator-run recovery for a known write-path gap: generate-localization-report.usecase.ts
 * persists a LocalizationAssessmentArtifact to CAS (authoritative, always valid on its own) and
 * then separately tries to register a discovery projection row for it. The two can fail
 * independently -- a real report response with `assessment_projection_registered: false` means
 * the assessment is fine but not yet discoverable by project. This script closes that gap
 * deterministically, from CAS + already-known refs, without touching CAS or re-deriving anything
 * that wasn't already computed once.
 *
 * Usage:
 *   npx tsx scripts/ops/reconcile-lu-assessment-projection.ts --project-id <id> --assessment-artifact-id <id>
 */
import '../../server/loadEnvFirst';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { resolveCanonicalProjectContext } from '../../src/application/resolveCanonicalProjectContext';
import { resolveCurrentProductRelease } from '../../src/application/resolveCurrentProductRelease';
import { reconcileAssessmentProjection } from '../../server/modules/localization/assessmentProjection';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`RECONCILE_ASSESSMENT_PROJECTION_REJECTED: --${name} is required`);
  return normalized;
}

async function main() {
  const projectId = required(option('project-id'), 'project-id');
  const assessmentArtifactId = required(option('assessment-artifact-id'), 'assessment-artifact-id');
  required(process.env.MIMERS_ROOT, 'MIMERS_ROOT');

  const mimers = await MimersIntegration.create({ forceMimers: true });
  const canonicalContext = await resolveCanonicalProjectContext(projectId, mimers.artifactRepository);
  const currentRelease = await resolveCurrentProductRelease(mimers.artifactRepository);

  const result = await reconcileAssessmentProjection({
    projectId,
    assessmentArtifactId,
    artifactRepository: mimers.artifactRepository,
    currentProjectContextRef: canonicalContext.projectContextRef,
    currentBindingRef: canonicalContext.contextBindingRef,
    currentReleaseRef: currentRelease.releaseRef,
  });

  console.log(JSON.stringify({ projectId, assessmentArtifactId, ...result }, null, 2));
  if (!result.reconciled) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
