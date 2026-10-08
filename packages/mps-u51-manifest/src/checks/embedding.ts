/**
 * C4 -- embedding identity (contract 5.4), fixed order:
 *   observation -> evidence hash -> strict payload -> same tree -> registry hash and the entry of `pipeline_key`
 *   equal the manifest on every field (presence of max_seq_length included) -> dimension -> admission hash and
 *   `admitted_keys == [pipeline_key]` -> the selection decision binds exactly this pipeline.
 *
 * `pipeline_version` is a label, so the whole registry entry is bound by `pipeline_spec_sha256`.
 */
import { EMBEDDING_IDENTITY_CONTRACT, FAILURE } from '../vocabulary';
import { hashJcs, sha256OfUtf8, tryHashJcs } from '../canonical';
import { jsonEqual } from '../json';
import { validateEmbeddingDerivation } from '../evidenceSchemas';
import { unwrapPayload, type StageContext } from './context';

export function checkEmbedding(ctx: StageContext): string | undefined {
  const { manifest, observations } = ctx;
  const claim = manifest.embedding;

  const found = unwrapPayload(observations, 'embedding');
  if (found.kind === 'absent') return FAILURE.manifest_unresolved_identity;
  if (found.kind === 'malformed') return FAILURE.evidence_schema_invalid;
  const payload = found.payload;
  const hash = tryHashJcs(payload);
  if (hash === undefined) return FAILURE.evidence_schema_invalid;
  if (hash !== claim.evidence_sha256) return FAILURE.manifest_hash_mismatch;
  if (!validateEmbeddingDerivation(payload)) return FAILURE.evidence_schema_invalid;
  if (payload.subject.tree_sha !== manifest.candidate.tree_sha) return FAILURE.tree_binding_mismatch;

  // identity: contract version, registry hash, the registry entry of this key, every field
  if (claim.contract_version !== EMBEDDING_IDENTITY_CONTRACT || claim.contract_version !== payload.identity_contract_version) {
    return FAILURE.embedding_identity_mismatch;
  }
  if (claim.registry_sha256 !== hashJcs(payload.registry.pipelines)) return FAILURE.embedding_identity_mismatch;
  const entry = payload.registry.pipelines.find((e) => e.pipeline_key === claim.pipeline_key);
  if (entry === undefined) return FAILURE.embedding_identity_mismatch;
  const sameIdentity =
    claim.model_id === entry.model_id &&
    claim.model_revision === entry.model_revision &&
    claim.pipeline_version === entry.pipeline_version &&
    claim.normalization === entry.normalization &&
    claim.query_prefix_sha256 === sha256OfUtf8(entry.query_prefix) &&
    claim.passage_prefix_sha256 === sha256OfUtf8(entry.passage_prefix) &&
    claim.snapshot_manifest_sha256 === entry.snapshot_manifest_sha256 &&
    claim.pipeline_spec_sha256 === hashJcs(entry) &&
    // presence of max_seq_length is part of the identity
    (claim.max_seq_length === undefined) === (entry.max_seq_length === undefined) &&
    claim.max_seq_length === entry.max_seq_length;
  if (!sameIdentity) return FAILURE.embedding_identity_mismatch;

  // dimension
  if (claim.dimension !== entry.dimension) return FAILURE.embedding_dimension_mismatch;

  // admission: exactly the manifest's key
  if (claim.admission_sha256 !== hashJcs(payload.admission.admitted_keys)) return FAILURE.embedding_identity_mismatch;
  if (!jsonEqual(payload.admission.admitted_keys, [claim.pipeline_key])) return FAILURE.embedding_not_admitted;

  // selection decision: the record is intact, is the one the manifest names, binds this pipeline and this spec,
  // says SELECTED, and the adapter reports its attestation verified (adapter-asserted: it can only deny)
  const selection = payload.selection_decision;
  const recordHash = hashJcs(selection.record);
  if (
    recordHash !== selection.record_sha256 ||
    recordHash !== claim.selection_decision_sha256 ||
    selection.record.pipeline_key !== claim.pipeline_key ||
    selection.record.pipeline_spec_sha256 !== hashJcs(entry) ||
    selection.record.decision !== 'SELECTED' ||
    selection.attestation_verified !== true
  ) {
    return FAILURE.manifest_unresolved_identity;
  }
  return undefined;
}
