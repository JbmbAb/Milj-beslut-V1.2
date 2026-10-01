import { describe, expect, it, vi } from 'vitest';

/**
 * W4 -- Part 2 (canonical LU projection), per Jimmy's own direct scoping (2026-09-30): the
 * projection sits strictly on top of Part 1's readiness check and must never produce an
 * authoritative LU result when readiness is not READY. This RED probe proves exactly that
 * boundary -- it does not yet specify the full shape of the AVAILABLE case (the findings/
 * provenance projection over an actually-verified assessment), which remains real future work per
 * the design note's own §4.4; only the fail-closed contract is frozen here.
 */

const mockResolveProjectContextReadiness = vi.fn();
vi.mock('../../src/application/resolveProjectContextReadiness', () => ({
  resolveProjectContextReadiness: (...args: unknown[]) => mockResolveProjectContextReadiness(...args),
}));

import { resolveCanonicalLuProjection } from '../../src/application/resolveCanonicalLuProjection';

const fakeRepo = {} as never;

describe('W4 -- resolveCanonicalLuProjection fail-closed contract', () => {
  it('cannot produce an authoritative LU result when readiness is NOT_READY', async () => {
    mockResolveProjectContextReadiness.mockResolvedValueOnce({ status: 'NOT_READY' });

    const result = await resolveCanonicalLuProjection('project-a', fakeRepo);

    expect(result.status).toBe('NOT_AVAILABLE');
    expect(Object.prototype.hasOwnProperty.call(result, 'findings')).toBe(false);
  });

  it('never resolves an assessment or reads project-context data when readiness is NOT_READY', async () => {
    // A fail-closed projection must short-circuit on NOT_READY before attempting anything else --
    // proven here by never even supplying a resolvable context; if the implementation tried to use
    // one anyway, this would throw instead of returning NOT_AVAILABLE cleanly.
    mockResolveProjectContextReadiness.mockResolvedValueOnce({ status: 'NOT_READY' });

    await expect(resolveCanonicalLuProjection('project-a', fakeRepo)).resolves.toEqual({
      status: 'NOT_AVAILABLE',
    });
  });
});
