import { describe, expect, it, vi } from 'vitest';

/**
 * W4 -- Part 1 (project-context readiness), per Jimmy's own direct scoping and explicit RED-probe
 * requirements (2026-09-30): a readiness check on top of the already-shipped, already-fails-closed
 * `resolveCanonicalProjectContext()`. NOT_READY deliberately covers three distinct failure classes
 * as one unified state -- missing binding, invalid/tampered binding, and authority-verification
 * failure -- none of which may ever be misread as READY or as an LU result. This wrapper adds no
 * new authority logic of its own; it only translates an already-governed outcome into an explicit,
 * typed result instead of an untyped thrown Error a caller must guess at.
 *
 * `resolveCanonicalProjectContext` itself is mocked at the module boundary throughout this file --
 * its own cryptographic verification (binding resolution, authority checks, content-hash
 * recomputation) is already extensively covered by its own existing test suite
 * (tests/unit/projectContextBindingRuntime.test.ts and siblings); this unit's own new logic is the
 * wrapper's translation/fail-closed/no-side-effect behavior, not a re-proof of crypto that is
 * already proven elsewhere.
 */

const mockResolveCanonicalProjectContext = vi.fn();
vi.mock('../../src/application/resolveCanonicalProjectContext', () => ({
  resolveCanonicalProjectContext: (...args: unknown[]) => mockResolveCanonicalProjectContext(...args),
}));

import { resolveProjectContextReadiness } from '../../src/application/resolveProjectContextReadiness';

const fakeRepo = {} as never;

const fakeContext = {
  projectContextRef: { artifact_id: 'lu-context-1', artifact_type: 'LU_PROJECT_CONTEXT' },
  propertyContextRef: { artifact_id: 'lu-property-1', artifact_type: 'LU_PROPERTY_CONTEXT' },
  contextBindingRef: { artifact_id: 'binding-1', artifact_type: 'project_context_binding' },
  geometryRef: { artifact_id: 'geom-1', artifact_type: 'geometry' },
  propertyDesignation: 'Orsa 1:1',
  propertyIdentity: 'orsa-1-1',
  municipality: 'Orsa',
  coordinates: [500000, 6800000] as const,
  geometry: { type: 'Polygon' as const, coordinates: [] },
};

describe('W4 -- resolveProjectContextReadiness', () => {
  it('returns READY with the real resolved context when a verified correct binding exists', async () => {
    mockResolveCanonicalProjectContext.mockResolvedValueOnce(fakeContext);

    const result = await resolveProjectContextReadiness('project-a', fakeRepo);

    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.context).toEqual(fakeContext);
    }
  });

  it('returns NOT_READY when no binding exists at all', async () => {
    mockResolveCanonicalProjectContext.mockRejectedValueOnce(
      new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE'),
    );

    const result = await resolveProjectContextReadiness('project-a', fakeRepo);

    expect(result.status).toBe('NOT_READY');
  });

  it('returns NOT_READY when a binding exists but cannot be cryptographically verified', async () => {
    mockResolveCanonicalProjectContext.mockRejectedValueOnce(
      new Error('REJECT_PROJECT_CONTEXT_BINDING_AUTHORITY_INVALID'),
    );

    const result = await resolveProjectContextReadiness('project-a', fakeRepo);

    expect(result.status).toBe('NOT_READY');
  });

  it('returns NOT_READY on a project/context mismatch, not a thrown error the caller must handle', async () => {
    mockResolveCanonicalProjectContext.mockRejectedValueOnce(
      new Error('REJECT_PROJECT_CONTEXT: binding project_id does not match requested project'),
    );

    await expect(resolveProjectContextReadiness('project-a', fakeRepo)).resolves.toEqual({
      status: 'NOT_READY',
    });
  });

  it('never synthesizes a fallback context -- a NOT_READY result carries no context field at all', async () => {
    mockResolveCanonicalProjectContext.mockRejectedValueOnce(new Error('REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE'));

    const result = await resolveProjectContextReadiness('project-a', fakeRepo);

    expect(result.status).toBe('NOT_READY');
    expect(Object.prototype.hasOwnProperty.call(result, 'context')).toBe(false);
  });

  it('has no bootstrap side effect from this read path -- the module never references the bootstrap-request mechanism', async () => {
    // A readiness check must never queue provisioning as a side effect of a read. Asserted at the
    // source level, mirroring this program's established "absence as proof" convention: if this
    // module ever starts importing or referencing the bootstrap-request mechanism, this test fails
    // and forces an explicit design decision (Q-W4-1) rather than a silent behavior change.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/application/resolveProjectContextReadiness.ts', 'utf8');
    expect(source).not.toMatch(/ProjectContextBootstrapRequest/);
    expect(source).not.toMatch(/projectContextBootstrapRequest/);
  });
});
