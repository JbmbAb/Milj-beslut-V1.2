/**
 * Pure trust boundary of the boot probe. It seals a generation-derivation entrypoint list only when
 * the observations are exactly the derived set, under the production profile, with no registered
 * runtime and a fail-closed generation call. It never copies derived_sha256 into claimed_sha256:
 * claimed is the hash of the entries that were actually accepted.
 */
import { deriveEntrypointSetSha256 } from '../../../mps-release-entrypoints/src/entrypointSet';
import type { EntrypointEntry } from '../../../mps-release-entrypoints/src/types';
import type { DerivedProbeEntry } from './types.js';

export interface ProbeObservation {
  readonly entry_id: string;
  readonly entry_file: string;
  readonly argv: readonly string[];
  readonly node_env: string;
  readonly registered_after_boot: boolean;
  readonly generate_attempt: { readonly outcome: string; readonly code?: string };
  readonly isolation_ok: boolean;
  readonly subject_commit: string;
  readonly subject_tree: string;
  readonly nonce_ok: boolean;
  readonly loaded_path_ok: boolean;
}

export interface SealedEntrypoint {
  readonly entry_id: string;
  readonly node_env: 'production';
  readonly registered_after_boot: false;
  readonly generate_attempt: { readonly outcome: 'FAIL_CLOSED'; readonly code: string };
}

export type SealResult =
  | { readonly ok: true; readonly claimed_sha256: string; readonly entrypoints: readonly SealedEntrypoint[] }
  | { readonly ok: false; readonly blocker: string };

export interface SealInput {
  readonly derived: readonly DerivedProbeEntry[];
  readonly derived_sha256: string;
  readonly observations: readonly ProbeObservation[];
  readonly subject_commit: string;
  readonly subject_tree: string;
  readonly fail_closed_code: string;
}

function byId(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function sameArgv(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

export function sealBootObservations(input: SealInput): SealResult {
  const derivedIds = new Set(input.derived.map((entry) => entry.id));
  const seen = new Set<string>();
  for (const observation of input.observations) {
    if (seen.has(observation.entry_id)) return { ok: false, blocker: 'DUPLICATE_ENTRYPOINT' };
    seen.add(observation.entry_id);
    if (!derivedIds.has(observation.entry_id)) return { ok: false, blocker: 'EXTRA_ENTRYPOINT' };
  }
  if (input.derived.some((entry) => !seen.has(entry.id))) return { ok: false, blocker: 'OMITTED_ENTRYPOINT' };

  const byObservation = new Map(input.observations.map((observation) => [observation.entry_id, observation]));
  for (const entry of input.derived) {
    const observation = byObservation.get(entry.id);
    if (observation === undefined) return { ok: false, blocker: 'OMITTED_ENTRYPOINT' };
    if (!observation.loaded_path_ok || observation.entry_file !== entry.entry_file || !sameArgv(observation.argv, entry.argv)) {
      return { ok: false, blocker: 'ENTRY_PATH_DIFFERS' };
    }
    if (!observation.nonce_ok || observation.subject_commit !== input.subject_commit || observation.subject_tree !== input.subject_tree) {
      return { ok: false, blocker: 'FOREIGN_SUBJECT' };
    }
    if (!observation.isolation_ok) return { ok: false, blocker: 'ISOLATION_BROKEN' };
    if (observation.node_env !== 'production') return { ok: false, blocker: 'PROFILE_NOT_PRODUCTION' };
    if (observation.registered_after_boot) return { ok: false, blocker: 'RUNTIME_REGISTERED' };
    if (observation.generate_attempt.outcome === 'SUCCESS') return { ok: false, blocker: 'GENERATION_RETURNED_SUCCESS' };
    if (observation.generate_attempt.outcome !== 'FAIL_CLOSED' || observation.generate_attempt.code !== input.fail_closed_code) {
      return { ok: false, blocker: 'UNEXPECTED_GENERATION_CODE' };
    }
  }

  const projected: EntrypointEntry[] = input.derived.map((entry) => ({
    id: entry.id,
    role: entry.role,
    argv: [...entry.argv],
    entry_file: entry.entry_file,
  }));
  const claimed = deriveEntrypointSetSha256(projected);
  if (claimed !== input.derived_sha256) return { ok: false, blocker: 'HASH_NOT_EQUAL' };

  const entrypoints: SealedEntrypoint[] = input.derived.map((entry) => ({
    entry_id: entry.id,
    node_env: 'production' as const,
    registered_after_boot: false as const,
    generate_attempt: { outcome: 'FAIL_CLOSED' as const, code: input.fail_closed_code },
  }));
  entrypoints.sort((a, b) => byId(a.entry_id, b.entry_id));
  return { ok: true, claimed_sha256: claimed, entrypoints };
}
