/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B -- one-time legacy currentness backfill.
 *
 * Generic across every project (never hardcodes a project list). For each project that has more
 * than one registered LocalizationGeometry candidate and zero existing supersession edges, mints a
 * signed linear chain of LocalizationGeometrySupersessionArtifacts (predecessor->successor)
 * ordered by each candidate's PROJECTION-ROW createdAt ASC -- reconstructing the OLD system's
 * observed createdAt-DESC "current" selection, one time, for already-existing data.
 *
 * Epistemic honesty (owner decision, explicit): this does NOT claim a signed supersession relation
 * existed historically -- the old system had no such concept. Every backfilled edge carries
 * reason_code = LEGACY_CURRENTNESS_MIGRATION_V1, distinct from the real live-worker reason code
 * (USER_LOCALIZATION_CHANGE_V1), so the provenance of every edge in CAS is honest and auditable.
 *
 * Fail-closed on ties: if two candidates for the same project share the exact same createdAt, that
 * project is reported BACKFILL_AMBIGUOUS and skipped entirely -- never an artifact-id tiebreaker,
 * which would just relocate the exact semantically-arbitrary-order problem H9 exists to eliminate.
 *
 * Idempotent: a project already classified as "already migrated" (>=1 existing edge) is skipped
 * entirely; within a fresh backfill, every CAS write and projection register is itself
 * content-addressed / ON CONFLICT DO NOTHING, so running this script twice produces zero new
 * semantic artifacts on the second run.
 *
 * Usage:
 *   npx tsx scripts/db/backfill-localization-geometry-supersession-01.ts --dry-run   (default; safe)
 *   npx tsx scripts/db/backfill-localization-geometry-supersession-01.ts --execute   (mutates)
 */
import '../../server/loadEnvFirst';
import { MimersIntegration } from '@miljobeslut/mps-runtime';
import { validateLocalizationGeometryArtifact, LEGACY_CURRENTNESS_MIGRATION_REASON_CODE, type LocalizationGeometryArtifact } from '@miljobeslut/mps-lu';
import { prisma } from '../../server/db/prisma';
import {
  PrismaLocalizationGeometryProjectionIndex,
  type LocalizationGeometryProjectionRow,
} from '../../server/repositories/localizationGeometryProjectionRepository';
import { PrismaLocalizationGeometrySupersessionIndex } from '../../server/repositories/localizationGeometrySupersessionRepository';
import { mintLegacyBackfillSupersession } from '../../server/modules/localization/luGeometrySupersessionProvisioning';

type ProjectClassification =
  | { readonly projectId: string; readonly outcome: 'SINGLE_GEOMETRY' }
  | { readonly projectId: string; readonly outcome: 'ALREADY_MIGRATED'; readonly existingEdgeCount: number }
  | { readonly projectId: string; readonly outcome: 'BACKFILL_AMBIGUOUS'; readonly reason: string }
  | { readonly projectId: string; readonly outcome: 'REQUIRES_BACKFILL'; readonly chain: readonly LocalizationGeometryProjectionRow[] };

export async function listDistinctProjectIds(): Promise<readonly string[]> {
  const rows = await prisma.$queryRawUnsafe<{ project_id: string }[]>(
    `SELECT DISTINCT "project_id" FROM "localization_geometry_projections"`,
  );
  return rows.map((r) => r.project_id);
}

export type { ProjectClassification };

export async function classifyProject(
  projectId: string,
  geometryIndex: Pick<PrismaLocalizationGeometryProjectionIndex, 'listForProject'>,
  supersessionIndex: Pick<PrismaLocalizationGeometrySupersessionIndex, 'listForProject'>,
): Promise<ProjectClassification> {
  const [candidates, existingEdges] = await Promise.all([
    geometryIndex.listForProject(projectId),
    supersessionIndex.listForProject(projectId),
  ]);

  if (existingEdges.length > 0) {
    return { projectId, outcome: 'ALREADY_MIGRATED', existingEdgeCount: existingEdges.length };
  }
  if (candidates.length <= 1) {
    return { projectId, outcome: 'SINGLE_GEOMETRY' };
  }

  const maxCreatedAt = Math.max(...candidates.map((c) => c.createdAt.getTime()));
  const tiedAtAnyLevel = candidates.some(
    (c, i) => candidates.findIndex((other) => other.createdAt.getTime() === c.createdAt.getTime()) !== i,
  );
  if (tiedAtAnyLevel) {
    return {
      projectId,
      outcome: 'BACKFILL_AMBIGUOUS',
      reason: `two or more candidates share the exact same createdAt (max observed: ${new Date(maxCreatedAt).toISOString()}) -- no artifact-id tiebreaker permitted`,
    };
  }

  const chain = [...candidates].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { projectId, outcome: 'REQUIRES_BACKFILL', chain };
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const dryRun = !execute; // dry-run is the default -- --execute is required to mutate anything.

  const mimers = await MimersIntegration.create({ forceMimers: true });
  const repo = mimers.artifactRepository;
  const geometryIndex = new PrismaLocalizationGeometryProjectionIndex();
  const supersessionIndex = new PrismaLocalizationGeometrySupersessionIndex();

  const projectIds = await listDistinctProjectIds();
  const classifications = await Promise.all(projectIds.map((id) => classifyProject(id, geometryIndex, supersessionIndex)));

  const singleGeometry = classifications.filter((c) => c.outcome === 'SINGLE_GEOMETRY');
  const alreadyMigrated = classifications.filter((c) => c.outcome === 'ALREADY_MIGRATED');
  const ambiguous = classifications.filter((c) => c.outcome === 'BACKFILL_AMBIGUOUS');
  const requiresBackfill = classifications.filter((c): c is Extract<ProjectClassification, { outcome: 'REQUIRES_BACKFILL' }> => c.outcome === 'REQUIRES_BACKFILL');
  const edgesToCreate = requiresBackfill.reduce((sum, c) => sum + (c.chain.length - 1), 0);

  const report = {
    dry_run: dryRun,
    projects_examined: projectIds.length,
    projects_single_geometry: singleGeometry.length,
    projects_requiring_backfill: requiresBackfill.length,
    projects_already_migrated: alreadyMigrated.length,
    projects_ambiguous: ambiguous.length,
    edges_to_create: edgesToCreate,
    ambiguous_detail: ambiguous.map((c) => (c.outcome === 'BACKFILL_AMBIGUOUS' ? { projectId: c.projectId, reason: c.reason } : null)),
    requires_backfill_detail: requiresBackfill.map((c) => ({
      projectId: c.projectId,
      chain: c.chain.map((row) => ({ geometryArtifactId: row.geometryArtifactId, createdAt: row.createdAt.toISOString() })),
    })),
  };

  if (dryRun) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`APPLYING backfill for ${requiresBackfill.length} project(s), ${edgesToCreate} edge(s) total.`);
  const results: Array<{ projectId: string; edgesCreated: number; edgesReused: number }> = [];
  for (const project of requiresBackfill) {
    let created = 0;
    let reused = 0;
    for (let i = 0; i < project.chain.length - 1; i += 1) {
      const predecessorRow = project.chain[i]!;
      const successorRow = project.chain[i + 1]!;

      // Re-resolve + re-verify both geometries against CAS before minting anything -- never trust
      // the projection row's own claim, same discipline as every other resolution path.
      const predecessor = validateLocalizationGeometryArtifact(
        await repo.resolve<LocalizationGeometryArtifact>({ artifact_id: predecessorRow.geometryArtifactId, artifact_type: 'localization_geometry' }),
      );
      if (predecessor.payload.project_id !== project.projectId) {
        throw new Error(`REJECT_BACKFILL: predecessor ${predecessorRow.geometryArtifactId} does not belong to project ${project.projectId}`);
      }
      const successor = validateLocalizationGeometryArtifact(
        await repo.resolve<LocalizationGeometryArtifact>({ artifact_id: successorRow.geometryArtifactId, artifact_type: 'localization_geometry' }),
      );
      if (successor.payload.project_id !== project.projectId) {
        throw new Error(`REJECT_BACKFILL: successor ${successorRow.geometryArtifactId} does not belong to project ${project.projectId}`);
      }

      const result = await mintLegacyBackfillSupersession({
        repo,
        projectId: project.projectId,
        predecessorGeometryArtifactId: predecessorRow.geometryArtifactId,
        successorGeometryArtifactId: successorRow.geometryArtifactId,
        // Deterministic, retry-stable: the successor's own projection-row createdAt -- reused
        // exactly for this one-time reconstruction, per the explicit LEGACY_CURRENTNESS_MIGRATION_V1
        // reason code, never confused with the live worker's own request-createdAt-derived scheme.
        issuedAt: successorRow.createdAt.toISOString(),
      });
      if (result.reused) reused += 1;
      else created += 1;
    }
    results.push({ projectId: project.projectId, edgesCreated: created, edgesReused: reused });
  }

  console.log(JSON.stringify({ applied: true, reason_code: LEGACY_CURRENTNESS_MIGRATION_REASON_CODE, results }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
