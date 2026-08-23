import { describe, expect, it } from 'vitest';
import { resolveCurrentLocalizationGeometryHead } from '../../packages/mps-lu/src/artifacts/LocalizationGeometrySupersessionGraph';
import type { LocalizationGeometryArtifact } from '../../packages/mps-lu/src/artifacts/LocalizationGeometryArtifact';
import type { LocalizationGeometrySupersessionArtifact } from '../../packages/mps-lu/src/artifacts/LocalizationGeometrySupersessionArtifact';

const PROJECT_ID = 'project-graph-test';

function geometry(id: string): LocalizationGeometryArtifact {
  return {
    artifact_id: id,
    artifact_type: 'localization_geometry',
    references: [],
    content_hash: { algorithm: 'sha256', value: id },
    payload: { project_id: PROJECT_ID } as LocalizationGeometryArtifact['payload'],
  } as unknown as LocalizationGeometryArtifact;
}

function edge(predecessorId: string, successorId: string): LocalizationGeometrySupersessionArtifact {
  return {
    artifact_id: `edge-${predecessorId}-${successorId}`,
    artifact_type: 'localization_geometry_supersession',
    references: [],
    content_hash: { algorithm: 'sha256', value: `${predecessorId}-${successorId}` },
    payload: {
      project_id: PROJECT_ID,
      predecessor_geometry_ref: { artifact_id: predecessorId, artifact_type: 'localization_geometry' },
      successor_geometry_ref: { artifact_id: successorId, artifact_type: 'localization_geometry' },
    } as LocalizationGeometrySupersessionArtifact['payload'],
  } as unknown as LocalizationGeometrySupersessionArtifact;
}

describe('LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1: resolveCurrentLocalizationGeometryHead (pure graph reduction)', () => {
  it('a single geometry with zero edges -> that geometry is the unique head (no root/activation artifact needed)', () => {
    const a = geometry('a');
    const head = resolveCurrentLocalizationGeometryHead({ projectId: PROJECT_ID, geometries: [a], supersessions: [] });
    expect(head.artifact_id).toBe('a');
  });

  it('A -> B: B is current, A is excluded from the head set (historical)', () => {
    const a = geometry('a');
    const b = geometry('b');
    const head = resolveCurrentLocalizationGeometryHead({ projectId: PROJECT_ID, geometries: [a, b], supersessions: [edge('a', 'b')] });
    expect(head.artifact_id).toBe('b');
  });

  it('A -> B -> C: C is current, order of the geometries/supersessions arrays does not matter', () => {
    const a = geometry('a');
    const b = geometry('b');
    const c = geometry('c');
    const head = resolveCurrentLocalizationGeometryHead({
      projectId: PROJECT_ID,
      geometries: [c, a, b],
      supersessions: [edge('b', 'c'), edge('a', 'b')],
    });
    expect(head.artifact_id).toBe('c');
  });

  it('createdAt and artifact-id lexical order play no role: this function accepts no timestamp at all', () => {
    // Structural proof: the function signature itself has no createdAt field on either input --
    // a fork must be resolved by the graph shape alone, never by any ordering heuristic.
    const a = geometry('zzz-last-lexically');
    const b = geometry('aaa-first-lexically');
    const head = resolveCurrentLocalizationGeometryHead({ projectId: PROJECT_ID, geometries: [a, b], supersessions: [edge('zzz-last-lexically', 'aaa-first-lexically')] });
    expect(head.artifact_id).toBe('aaa-first-lexically'); // successor wins regardless of lexical order
  });

  it('fork (A->B and A->C) -> AMBIGUOUS_CURRENT_GEOMETRY, fail closed', () => {
    const a = geometry('a');
    const b = geometry('b');
    const c = geometry('c');
    expect(() =>
      resolveCurrentLocalizationGeometryHead({ projectId: PROJECT_ID, geometries: [a, b, c], supersessions: [edge('a', 'b'), edge('a', 'c')] }),
    ).toThrow('AMBIGUOUS_CURRENT_GEOMETRY');
  });

  it('two independent unconnected geometries (no edge between them) -> AMBIGUOUS_CURRENT_GEOMETRY, fail closed', () => {
    const a = geometry('a');
    const b = geometry('b');
    expect(() => resolveCurrentLocalizationGeometryHead({ projectId: PROJECT_ID, geometries: [a, b], supersessions: [] })).toThrow(
      'AMBIGUOUS_CURRENT_GEOMETRY',
    );
  });

  it('cycle (A->B->A) -> INVALID_SUPERSESSION_GRAPH, fail closed', () => {
    const a = geometry('a');
    const b = geometry('b');
    expect(() =>
      resolveCurrentLocalizationGeometryHead({ projectId: PROJECT_ID, geometries: [a, b], supersessions: [edge('a', 'b'), edge('b', 'a')] }),
    ).toThrow('INVALID_SUPERSESSION_GRAPH');
  });

  it('zero geometries -> rejected (caller is expected to treat zero candidates as NOT_FOUND before calling this)', () => {
    expect(() => resolveCurrentLocalizationGeometryHead({ projectId: PROJECT_ID, geometries: [], supersessions: [] })).toThrow();
  });

  it('an edge referencing a geometry outside the supplied set is rejected -- never silently ignored', () => {
    const a = geometry('a');
    const b = geometry('b');
    expect(() =>
      resolveCurrentLocalizationGeometryHead({ projectId: PROJECT_ID, geometries: [a], supersessions: [edge('a', 'b')] }),
    ).toThrow('missing relation geometry');
    void b;
  });

  it('a geometry belonging to a different project is rejected', () => {
    const wrongProject = { ...geometry('x'), payload: { project_id: 'some-other-project' } } as unknown as LocalizationGeometryArtifact;
    expect(() => resolveCurrentLocalizationGeometryHead({ projectId: PROJECT_ID, geometries: [wrongProject], supersessions: [] })).toThrow(
      'geometry project',
    );
  });
});
