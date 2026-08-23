import { describe, expect, it } from 'vitest';
import { classifyProject } from '../../scripts/db/backfill-localization-geometry-supersession-01';
import type { LocalizationGeometryProjectionRow } from '../../server/repositories/localizationGeometryProjectionRepository';
import type { LocalizationGeometrySupersessionRow } from '../../server/repositories/localizationGeometrySupersessionRepository';

function geometryRow(id: string, createdAt: string): LocalizationGeometryProjectionRow {
  return {
    projectId: 'proj-1',
    geometryArtifactId: id,
    propertyContextRefId: 'property-1',
    propertyContextRefType: 'PROPERTY',
    createdAt: new Date(createdAt),
  };
}

function fakeIndexes(geometries: LocalizationGeometryProjectionRow[], supersessions: LocalizationGeometrySupersessionRow[] = []) {
  return {
    geometryIndex: { listForProject: async () => geometries },
    supersessionIndex: { listForProject: async () => supersessions },
  };
}

describe('LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1: backfill classification (generic, no hardcoded project list)', () => {
  it('single geometry -> SINGLE_GEOMETRY, no backfill needed', async () => {
    const { geometryIndex, supersessionIndex } = fakeIndexes([geometryRow('g1', '2026-08-20T00:00:00Z')]);
    const result = await classifyProject('proj-1', geometryIndex, supersessionIndex);
    expect(result.outcome).toBe('SINGLE_GEOMETRY');
  });

  it('project already has a supersession edge -> ALREADY_MIGRATED, skipped entirely regardless of geometry count', async () => {
    const { geometryIndex, supersessionIndex } = fakeIndexes(
      [geometryRow('g1', '2026-08-20T00:00:00Z'), geometryRow('g2', '2026-08-21T00:00:00Z')],
      [{ projectId: 'proj-1', supersessionArtifactId: 'edge-1', predecessorGeometryArtifactId: 'g1', successorGeometryArtifactId: 'g2', createdAt: new Date() }],
    );
    const result = await classifyProject('proj-1', geometryIndex, supersessionIndex);
    expect(result.outcome).toBe('ALREADY_MIGRATED');
    if (result.outcome === 'ALREADY_MIGRATED') expect(result.existingEdgeCount).toBe(1);
  });

  it('multiple geometries, distinct createdAt, no existing edges -> REQUIRES_BACKFILL with the correct ASC chain', async () => {
    const { geometryIndex, supersessionIndex } = fakeIndexes([
      geometryRow('g3', '2026-08-22T00:00:00Z'),
      geometryRow('g1', '2026-08-20T00:00:00Z'),
      geometryRow('g2', '2026-08-21T00:00:00Z'),
    ]);
    const result = await classifyProject('proj-1', geometryIndex, supersessionIndex);
    expect(result.outcome).toBe('REQUIRES_BACKFILL');
    if (result.outcome === 'REQUIRES_BACKFILL') {
      expect(result.chain.map((r) => r.geometryArtifactId)).toEqual(['g1', 'g2', 'g3']);
    }
  });

  it('two candidates tied at the exact same createdAt -> BACKFILL_AMBIGUOUS, fail closed, no artifact-id tiebreaker', async () => {
    const tied = '2026-08-20T12:00:00.000Z';
    const { geometryIndex, supersessionIndex } = fakeIndexes([geometryRow('g1', tied), geometryRow('g2', tied)]);
    const result = await classifyProject('proj-1', geometryIndex, supersessionIndex);
    expect(result.outcome).toBe('BACKFILL_AMBIGUOUS');
  });

  it('a tie among three, only two of which collide -> still BACKFILL_AMBIGUOUS for the whole project (never partially resolved)', async () => {
    const { geometryIndex, supersessionIndex } = fakeIndexes([
      geometryRow('g1', '2026-08-20T00:00:00.000Z'),
      geometryRow('g2', '2026-08-21T00:00:00.000Z'),
      geometryRow('g3', '2026-08-21T00:00:00.000Z'), // collides with g2
    ]);
    const result = await classifyProject('proj-1', geometryIndex, supersessionIndex);
    expect(result.outcome).toBe('BACKFILL_AMBIGUOUS');
  });

  it('zero geometries for a project -> SINGLE_GEOMETRY branch (trivially, nothing to backfill)', async () => {
    const { geometryIndex, supersessionIndex } = fakeIndexes([]);
    const result = await classifyProject('proj-1', geometryIndex, supersessionIndex);
    expect(result.outcome).toBe('SINGLE_GEOMETRY');
  });
});
