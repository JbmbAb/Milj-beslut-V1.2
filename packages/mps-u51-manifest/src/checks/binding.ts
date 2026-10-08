/**
 * C2 -- candidate binding (contract 9, 7.3 origin): commit -> tree, origin reachability, release reference.
 * Fixed order; the release is NEVER re-verified here: `verified` is the existing release authority's verdict as
 * reported by the adapter (the core is pure).
 */
import { FAILURE } from '../vocabulary';
import { hasExactKeys, isHex40, isHex64, isNonEmptyString, isRecord, type Rec } from '../json';
import type { StageContext } from './context';

const OBSERVATION_KEYS = ['subject', 'origin', 'release', 'zero_google', 'embedding', 'schema', 'generation'];

const validSubject = (v: unknown): v is { commit_sha: string; commit_tree_sha: string } =>
  isRecord(v) && hasExactKeys(v, ['commit_sha', 'commit_tree_sha']) && isHex40(v.commit_sha) && isHex40(v.commit_tree_sha);

const validOrigin = (v: unknown): v is { commit_sha: string; reachable: boolean; remote_identity_sha256: string } =>
  isRecord(v) && hasExactKeys(v, ['commit_sha', 'reachable', 'remote_identity_sha256']) && isHex40(v.commit_sha) && typeof v.reachable === 'boolean' && isHex64(v.remote_identity_sha256);

interface ReleaseObservation {
  verified: boolean;
  artifact_id: string;
  contract_version: string;
  release_hash_sha256: string;
  source_commit_sha: string;
  source_tree_sha: string;
}
const validRelease = (v: unknown): v is ReleaseObservation =>
  isRecord(v) &&
  hasExactKeys(v, ['verified', 'artifact_id', 'contract_version', 'release_hash_sha256', 'source_commit_sha', 'source_tree_sha']) &&
  typeof v.verified === 'boolean' &&
  isNonEmptyString(v.artifact_id) &&
  isNonEmptyString(v.contract_version) &&
  isHex64(v.release_hash_sha256) &&
  isHex40(v.source_commit_sha) &&
  isHex40(v.source_tree_sha);

export function checkBinding(ctx: StageContext): string | undefined {
  const { manifest, policy, observations } = ctx;
  if (!Object.keys(observations).every((k) => OBSERVATION_KEYS.includes(k))) return FAILURE.evidence_schema_invalid;

  // 1. commit -> tree
  const subject: unknown = observations.subject;
  if (subject === undefined || subject === null) return FAILURE.manifest_unresolved_identity;
  if (!validSubject(subject)) return FAILURE.evidence_schema_invalid;
  if (subject.commit_sha !== manifest.candidate.commit_sha || subject.commit_tree_sha !== manifest.candidate.tree_sha) {
    return FAILURE.tree_binding_mismatch;
  }

  // 2. origin, when the owner policy requires it (OD-16); a present observation is validated either way
  const origin: unknown = observations.origin;
  const originPresent = origin !== undefined && origin !== null;
  if (policy.origin_requirement === 'REQUIRED') {
    if (!originPresent) return FAILURE.candidate_not_on_origin;
    if (!validOrigin(origin)) return FAILURE.evidence_schema_invalid;
    if (origin.commit_sha !== manifest.candidate.commit_sha || origin.reachable !== true) return FAILURE.candidate_not_on_origin;
  } else if (originPresent && !validOrigin(origin)) {
    return FAILURE.evidence_schema_invalid;
  }

  // 3. release: verified through the existing authority, then id / contract / hash, accepted version, same tree
  const release: unknown = observations.release;
  if (release === undefined || release === null) return FAILURE.release_reference_invalid;
  if (!validRelease(release)) return FAILURE.evidence_schema_invalid;
  if (release.verified !== true) return FAILURE.release_reference_invalid;
  const claim = manifest.release;
  if (release.artifact_id !== claim.artifact_id || release.contract_version !== claim.contract_version || release.release_hash_sha256 !== claim.release_hash_sha256) {
    return FAILURE.release_reference_invalid;
  }
  if (!policy.accepted_release_contract_versions.includes(claim.contract_version)) return FAILURE.release_reference_invalid;
  if (release.source_tree_sha !== manifest.candidate.tree_sha || release.source_commit_sha !== manifest.candidate.commit_sha) {
    return FAILURE.tree_binding_mismatch;
  }
  return undefined;
}

export type { Rec };
