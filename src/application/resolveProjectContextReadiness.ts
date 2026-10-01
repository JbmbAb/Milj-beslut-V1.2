/**
 * W4 -- Part 1 (project-context readiness), per Jimmy's own direct scoping (2026-09-30).
 *
 * A thin translation over the already-shipped, already-fails-closed `resolveCanonicalProjectContext()`:
 * turns its untyped thrown `Error` into an explicit, typed result a caller can switch on, instead
 * of catching an exception and guessing at its message string. This adds no new authority logic --
 * every failure `resolveCanonicalProjectContext()` can produce (missing binding, invalid/tampered
 * binding, authority-verification failure, project/context mismatch) is deliberately folded into a
 * single `NOT_READY` state here. None of these may ever be misread as `READY` or as an LU result;
 * refined diagnostics distinguishing them from each other may come later without changing this
 * authority semantics.
 *
 * No fallback: a `NOT_READY` result never carries a context. No new signer authority: this module
 * performs no cryptographic operations of its own. No bootstrap side effect: this module never
 * references the `ProjectContextBootstrapRequest` mechanism -- requesting provisioning is a
 * deliberately separate, explicit action, never an implicit consequence of a read.
 */
import type { ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import {
  resolveCanonicalProjectContext,
  type CanonicalProjectContext,
} from './resolveCanonicalProjectContext';
import type { PrismaProjectContextBindingIndex } from '../../server/repositories/projectContextBindingRepository';

export type ProjectContextReadiness =
  | { readonly status: 'READY'; readonly context: CanonicalProjectContext }
  | { readonly status: 'NOT_READY' };

export async function resolveProjectContextReadiness(
  projectId: string,
  repo: ArtifactRepositoryPort,
  index?: PrismaProjectContextBindingIndex,
): Promise<ProjectContextReadiness> {
  try {
    const context = await resolveCanonicalProjectContext(projectId, repo, index);
    return { status: 'READY', context };
  } catch {
    return { status: 'NOT_READY' };
  }
}
