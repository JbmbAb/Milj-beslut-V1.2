import { sha256CanonicalJson } from '../../mps-compliance/src/canonical/sha256Canonical.js';
import type { Census, ClosureResult } from './reachability';

/**
 * The closure artifact: a canonical JSON of the computed closure of ONE exact commit/tree, hashed with the
 * repository's RFC 8785 primitive over the PARSED OBJECT (so the on-disk formatting does not matter).
 *
 * Deterministic by construction: sorted roots, sorted file lists, sorted unresolved and census hits, and no timestamp,
 * absolute path, machine name or user name. The artifact names the commit and tree it was computed from, so a
 * different commit gives a different artifact.
 */

export const CLOSURE_ARTIFACT_SCHEMA_ID = 'u51-d-closure-1' as const;

export interface ClosureArtifactInput {
  readonly commit: string;
  readonly tree: string;
  readonly entrypoints: {
    readonly derived_sha256: string;
    readonly file_jcs_sha256: string;
    readonly file_bytes_sha256: string;
    readonly entry_files: readonly string[];
    readonly not_production_files: readonly string[];
  };
  readonly closure: ClosureResult;
  readonly census: Census;
  /** whether the frozen-test-file question is asked: paths of test files found in the union closure (empty = none) */
  readonly test_files_in_union: readonly string[];
  /** files whose membership in each root's closure is asked about (sorted into the artifact); may be empty */
  readonly watch_files?: readonly string[];
}

export interface WatchedFile {
  readonly file: string;
  readonly in_union_all: boolean;
  readonly in_union_value: boolean;
  readonly roots_all: readonly string[];
  readonly roots_value: readonly string[];
}

export interface ClosureArtifact {
  readonly schema: typeof CLOSURE_ARTIFACT_SCHEMA_ID;
  readonly subject: { readonly commit: string; readonly tree: string };
  readonly entrypoints: ClosureArtifactInput['entrypoints'];
  readonly roots: readonly string[];
  readonly per_root: ReadonlyArray<{ root: string; files_all: number; files_value: number }>;
  readonly union_all: readonly string[];
  readonly union_value_count: number;
  readonly external_packages: readonly string[];
  readonly unresolved: ClosureResult['unresolved'];
  readonly unresolved_count: number;
  readonly test_files_in_union: readonly string[];
  readonly watched: readonly WatchedFile[];
  readonly census: Census;
}

export function buildClosureArtifact(input: ClosureArtifactInput): { artifact: ClosureArtifact; sha256: string } {
  const artifact: ClosureArtifact = {
    schema: CLOSURE_ARTIFACT_SCHEMA_ID,
    subject: { commit: input.commit, tree: input.tree },
    entrypoints: {
      derived_sha256: input.entrypoints.derived_sha256,
      file_jcs_sha256: input.entrypoints.file_jcs_sha256,
      file_bytes_sha256: input.entrypoints.file_bytes_sha256,
      entry_files: [...input.entrypoints.entry_files].sort(),
      not_production_files: [...input.entrypoints.not_production_files].sort(),
    },
    roots: [...input.closure.roots].sort(),
    per_root: input.closure.per_root.map((r) => ({ root: r.root, files_all: r.files_all.length, files_value: r.files_value.length })),
    union_all: [...input.closure.union_all].sort(),
    union_value_count: input.closure.union_value.length,
    external_packages: [...input.closure.external_packages].sort(),
    unresolved: input.closure.unresolved,
    unresolved_count: input.closure.unresolved.length,
    test_files_in_union: [...input.test_files_in_union].sort(),
    watched: [...(input.watch_files ?? [])].sort().map((file) => ({
      file,
      in_union_all: input.closure.union_all.includes(file),
      in_union_value: input.closure.union_value.includes(file),
      roots_all: input.closure.per_root.filter((r) => r.files_all.includes(file)).map((r) => r.root),
      roots_value: input.closure.per_root.filter((r) => r.files_value.includes(file)).map((r) => r.root),
    })),
    census: input.census,
  };
  return { artifact, sha256: sha256CanonicalJson(artifact) };
}
