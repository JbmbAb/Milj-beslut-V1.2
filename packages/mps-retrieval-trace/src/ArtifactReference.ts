/**
 * LEGAL-RETRIEVAL-TRACE-REPAIR-01.
 *
 * Minimal local type matching the shape already relied on by RetrievalTraceIdentity.ts and its
 * tests -- previously imported from `../../mps-retrieval-governance/src/ArtifactReader`, a file
 * that does not exist anywhere in the repo (a real, uncaught defect: vitest's esbuild transform
 * silently elides this type-only import, so the package's tests passed despite the import never
 * resolving; `tsc --noEmit` failed). Defined locally, in-package, rather than reintroducing a
 * cross-package dependency on a file that was never built -- no retrieval semantics changed, this
 * is exactly the shape every existing consumer already assumed.
 */
export interface ArtifactReference {
  readonly id: string;
  readonly artifact_class: string;
}
