/**
 * Step 1 of materialization: evidence references must be resolvable before
 * anything downstream is allowed to run.
 */

export interface EvidenceResolver {
  /** True when the source artifact is resolvable in the evidence store. */
  has(source_artifact_hash: string): boolean;
}

/**
 * Default for callers that hand in an already verified evidence set.
 * Deployments that must prove CAS presence inject a resolver backed by the store.
 */
export const preVerifiedEvidenceResolver: EvidenceResolver = Object.freeze({
  has: () => true,
});

export function createSetEvidenceResolver(available: Iterable<string>): EvidenceResolver {
  const set = new Set(available);
  return Object.freeze({ has: (hash: string) => set.has(hash) });
}
