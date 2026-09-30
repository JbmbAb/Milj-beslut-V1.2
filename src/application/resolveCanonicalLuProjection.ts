/**
 * W4 -- Part 2 (canonical LU projection), per Jimmy's own direct scoping (2026-09-30).
 *
 * Sits strictly on top of Part 1's readiness check (`resolveProjectContextReadiness`) -- binding
 * comes first, this projection does not replace it. Fail-closed: when readiness is not `READY`,
 * this projection must never attempt to produce, derive, or infer an authoritative LU result --
 * it returns an explicit `NOT_AVAILABLE` and stops.
 *
 * The `AVAILABLE` case (propagating an already-verified governed assessment's findings and
 * provenance once readiness is `READY`) is real future work, not built in this candidate --
 * per Jimmy's own "RED-only ska frysa kontraktet, inte lösningen": this candidate freezes the
 * fail-closed boundary, not the happy path.
 */
import type { ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import { resolveProjectContextReadiness } from './resolveProjectContextReadiness';
import type { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';

export type CanonicalLuProjection = { readonly status: 'NOT_AVAILABLE' };

export async function resolveCanonicalLuProjection(
  projectId: string,
  repo: ArtifactRepositoryPort,
  index?: PrismaProjectContextBindingIndex,
): Promise<CanonicalLuProjection> {
  const readiness = await resolveProjectContextReadiness(projectId, repo, index);
  if (readiness.status !== 'READY') {
    return { status: 'NOT_AVAILABLE' };
  }
  // W4 -- deliberately not implemented in this candidate: propagating an already-verified
  // governed assessment's findings/provenance once readiness is READY is real future work (see
  // this unit's own audit doc §3, "Non-claims"). Throwing here, rather than silently returning
  // NOT_AVAILABLE for a READY project too, keeps the gap visible instead of indistinguishable
  // from an intentional "no result" design choice.
  throw new Error('W4_NOT_IMPLEMENTED: the AVAILABLE projection case is not built in this candidate');
}
