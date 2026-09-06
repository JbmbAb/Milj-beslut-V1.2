import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';
import { determineRelations } from '@miljobeslut/mps-chunking';
import {
  buildCanonicalLegalCorpusRecordKey,
  computeChunkSetContentHash,
  CORPUS_MATERIALIZATION_VERSION,
  type ChunkStructureKind,
  type LegalChunk,
  type LegalCorpusMaterializationIdentityInput,
} from '@miljobeslut/mps-legal-corpus';
import {
  TextIngestionPipeline,
  TEXT_PROJECTION_VERSION,
  type OcrPort,
  type SourceArtifact,
  type TextExtractorPort,
  type TextProjection,
} from '@miljobeslut/mps-text-projection';

import type { RejectedFragment } from './ChunkAdmission';
import { admitWithPolicy, defaultChunkPolicyFor } from './ChunkPolicyRegistry';
import { buildRawSourceArtifactRef, computeKnowledgeDocumentId, sha256Hex } from './DocumentIdentity';
import {
  evidenceDocTypeForRole,
  isDocumentRole,
  resolveDocumentRole,
  roleFromCallerDeclaration,
  roleFromSourceDeclaration,
  structureKindForRole,
  type DocumentRole,
  type DocumentRoleAssignment,
} from './DocumentRole';
import {
  assertHtmlBytesWithinBudget,
  assertProjectedCharsWithinBudget,
  assertRawBytesWithinBudget,
  DEFAULT_CONTENT_BUDGET,
  type ContentBudget,
} from './PathSafety';
import {
  classifySourceAuthority,
  type AuthorizedSourceBinding,
  type AuthorizedSourceCatalog,
  type SourceAuthorityOutcome,
} from './SourceAuthority';
import { KNOWLEDGE_CORPUS_PROJECTION_VERSION, LINK_CANDIDATE_RULES_VERSION } from './versions';

/**
 * KNOWLEDGE-CORPUS-PROJECTION-V1 — the deterministic kernel:
 *
 *   authorized source binding
 *     -> content-derived document identity (KNOWLEDGE-DOCUMENT-V1)
 *     -> TEXT-L1 TextProjection (the real builder, with an EXPLICIT OCR policy)
 *     -> versioned document role with derivation provenance
 *     -> governed chunk admission under a REGISTERED chunk policy
 *     -> materialization identity (legal-corpus-record-v2, unchanged kernel)
 *     -> ordered provenance chain + DERIVED link candidates
 *
 * Pure with respect to storage: no database, no network, no signing, no attestation. It cannot make
 * anything canonical; it produces the exact, replayable inputs that the existing governed gate +
 * materializer consume, and the exact identities a read model must resolve back to.
 */

export interface AcquisitionProvenance {
  /** DiskQuarantineStorage object id the bytes were read from. Provenance METADATA, never identity. */
  readonly quarantine_id?: string;
  readonly acquired_at?: string;
  readonly source_url?: string;
  readonly download_manifest_ref?: {
    readonly id: string;
    readonly content_hash: { readonly algorithm: 'sha256'; readonly digest: string };
  };
  readonly archive_locator?: string;
}

export type OcrPolicy = { readonly mode: 'disabled' } | { readonly mode: 'fallback'; readonly port: OcrPort };

export interface CorpusDocumentInput {
  readonly source_id: string;
  /** Caller's expectation of the signed source scope; a mismatch is SOURCE_SCOPE_CHANGED, never a silent re-bind. */
  readonly expected_registry_source_content_hash?: string;
  /** Observed file name — carried as metadata for humans and classifier hints; never identity. */
  readonly doc_name: string;
  readonly mime_type?: string;
  readonly bytes?: Uint8Array;
  /** Trusted pre-extracted text (tests / upstream projections). Recorded as extraction method `preextracted`. */
  readonly preextracted_text?: string;
  readonly preextracted_version?: string;
  /** Explicit role from the caller's own governed manifest. Recorded as CALLER_DECLARED, not as a source fact. */
  readonly declared_role?: DocumentRole;
  readonly declared_role_reason?: string;
  /** A source-supported version label (e.g. "SFS 1998:808 t.o.m. SFS 2025:xxx"). Metadata only. */
  readonly source_version_label?: string;
  readonly acquisition?: AcquisitionProvenance;
  /**
   * Which LOGICAL publication this acquisition is a version of. Two documents form a version lineage
   * only when they share source, registry scope AND this key. Defaults to the acquisition's
   * `source_url` (the same publication locator re-harvested = a new version of the same thing);
   * with neither, the document is its own singleton — a multi-document source (one entry, many
   * decisions) is NEVER treated as one lineage. Metadata, never identity.
   */
  readonly version_lineage_key?: string;
  /** Override the registered default policy for the resolved family (must itself be registered). */
  readonly chunk_policy_version?: string;
}

export interface ProjectionDependencies {
  readonly catalog: AuthorizedSourceCatalog;
  readonly extractor?: TextExtractorPort;
  readonly ocr?: OcrPolicy;
  readonly budget?: ContentBudget;
}

export type ProvenanceStage = 'SOURCE_REGISTRY' | 'RAW_SOURCE' | 'TEXT_PROJECTION' | 'CHUNK_SET';

export interface ProvenanceLink {
  readonly stage: ProvenanceStage;
  readonly ref: string;
  readonly content_hash: string;
  readonly version: string;
  readonly derived_from: string | null;
}

export interface LinkCandidate {
  readonly relation: string;
  readonly target: string;
  readonly method: 'EVIDENCE_RELATION_RULES' | 'LAW_CITATION_PATTERN';
  readonly rules_version: string;
  readonly confidence: 'low' | 'medium';
  readonly evidence_fragment_ids: readonly string[];
  /** Always false: a candidate is DERIVED. Only a source-supported, reviewed binding may become canonical, and not here. */
  readonly canonical: false;
}

export type ProjectionStatus =
  'PROJECTED' | 'EXTRACTION_FAILED' | 'EMPTY_TEXT' | 'NOT_ADMITTED' | 'STRUCTURE_PARTIAL';

export interface CorpusDocumentProjection {
  readonly projection_version: typeof KNOWLEDGE_CORPUS_PROJECTION_VERSION;
  readonly document_id: string;
  readonly source: AuthorizedSourceBinding;
  readonly catalog_origin: string;
  readonly doc_name: string;
  readonly mime_type?: string;
  readonly byte_size: number;
  readonly raw_source_content_hash: string;
  readonly text_projection: TextProjection;
  readonly text_projection_contract_version: typeof TEXT_PROJECTION_VERSION;
  readonly role: DocumentRoleAssignment;
  readonly structure_kind: ChunkStructureKind;
  readonly chunk_policy_version: string;
  readonly chunks: readonly LegalChunk[];
  readonly rejected_fragments: readonly RejectedFragment[];
  readonly chunk_set_content_hash: string;
  readonly materialization_identity: LegalCorpusMaterializationIdentityInput;
  readonly canonical_record_key: string;
  readonly provenance_chain: readonly ProvenanceLink[];
  readonly link_candidates: readonly LinkCandidate[];
  readonly status: ProjectionStatus;
  readonly status_detail?: string;
  readonly source_version_label?: string;
  readonly acquisition?: AcquisitionProvenance;
  /** Resolved lineage key (explicit ?? acquisition.source_url ?? null). null = singleton, no version notion. */
  readonly version_lineage_key: string | null;
}

export type ProjectDocumentOutcome =
  | { readonly kind: 'PROJECTED'; readonly document: CorpusDocumentProjection }
  | Exclude<SourceAuthorityOutcome, { kind: 'AUTHORIZED' }>
  | { readonly kind: 'UNSUPPORTED_ARTIFACT_TYPE'; readonly source_id: string; readonly detail: string }
  | { readonly kind: 'REJECTED_INPUT'; readonly source_id: string; readonly detail: string };

export async function projectDocument(
  input: CorpusDocumentInput,
  deps: ProjectionDependencies,
): Promise<ProjectDocumentOutcome> {
  const authority = await classifySourceAuthority(
    deps.catalog,
    input.source_id,
    input.expected_registry_source_content_hash,
  );
  if (authority.kind !== 'AUTHORIZED') return authority;
  const binding = authority.binding;

  const sourceDeclared = roleFromSourceDeclaration(binding);
  if (sourceDeclared === null) {
    return {
      kind: 'UNSUPPORTED_ARTIFACT_TYPE',
      source_id: input.source_id,
      detail: `registry entry '${binding.registry_artifact_id}' declares artifact_types ${JSON.stringify(binding.artifact_types)}, which this text corpus cannot represent.`,
    };
  }

  const budget = deps.budget ?? DEFAULT_CONTENT_BUDGET;
  let bytes: Uint8Array | undefined = input.bytes;
  if (bytes === undefined && input.preextracted_text === undefined) {
    return {
      kind: 'REJECTED_INPUT',
      source_id: input.source_id,
      detail: 'either bytes or preextracted_text is required',
    };
  }
  if (bytes === undefined) bytes = new TextEncoder().encode(input.preextracted_text as string);
  try {
    assertRawBytesWithinBudget(bytes.byteLength, budget);
    if (input.mime_type === 'text/html') assertHtmlBytesWithinBudget(bytes.byteLength, budget);
  } catch (err) {
    return {
      kind: 'REJECTED_INPUT',
      source_id: input.source_id,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (bytes !== undefined && input.preextracted_text === undefined && !deps.extractor) {
    return {
      kind: 'REJECTED_INPUT',
      source_id: input.source_id,
      detail: 'bytes extraction requires a TextExtractorPort',
    };
  }

  const rawSourceContentHash = sha256Hex(bytes);
  const documentId = computeKnowledgeDocumentId({
    logical_source_id: binding.source_id,
    registry_source_content_hash: binding.registry_source_content_hash,
    raw_source_content_hash: rawSourceContentHash,
  });

  const rawLineageKey = input.version_lineage_key ?? input.acquisition?.source_url;
  if (
    rawLineageKey !== undefined &&
    (typeof rawLineageKey !== 'string' || rawLineageKey.trim().length === 0)
  ) {
    return {
      kind: 'REJECTED_INPUT',
      source_id: input.source_id,
      detail: 'version_lineage_key / source_url must be a non-empty string when given',
    };
  }
  const lineageKey: string | null = rawLineageKey === undefined ? null : rawLineageKey.trim();
  if (input.declared_role !== undefined && !isDocumentRole(input.declared_role)) {
    return {
      kind: 'REJECTED_INPUT',
      source_id: input.source_id,
      detail: `declared_role '${String(input.declared_role)}' is not a document role`,
    };
  }
  const callerDeclared = input.declared_role
    ? roleFromCallerDeclaration(
        input.declared_role,
        input.declared_role_reason ?? 'declared by caller manifest',
      )
    : undefined;
  const evidenceHint = callerDeclared?.evidence_doc_type ?? sourceDeclared.evidence_doc_type;

  const source: SourceArtifact = {
    ref: buildRawSourceArtifactRef(rawSourceContentHash),
    bytes_content_hash: { algorithm: 'sha256', value: rawSourceContentHash },
    ...(input.mime_type ? { mime_type: input.mime_type } : {}),
    doc_name: input.doc_name,
    source_system: binding.source_id,
    ...(evidenceHint ? { evidence_doc_type: evidenceHint } : {}),
  };

  // TEXT-L1 through the sole authorized factory, with an EXPLICIT OCR policy. Default is
  // disabled: an LLM-OCR result is model output, and silently letting it become the projection
  // text (and therefore content identity) is exactly what the archaeology flagged.
  const pipeline = new TextIngestionPipeline({
    ...(deps.extractor ? { extractor: deps.extractor } : {}),
    ...(deps.ocr?.mode === 'fallback'
      ? { ocr: deps.ocr.port, enable_ocr_fallback: true }
      : { enable_ocr_fallback: false }),
  });
  const ingested = await pipeline.ingest(
    {
      source,
      ...(input.preextracted_text !== undefined
        ? {
            preextracted_text: input.preextracted_text,
            preextracted_version: input.preextracted_version ?? 'caller',
          }
        : { bytes }),
    },
    { chunk: false },
  );
  const projection = ingested.projection;
  try {
    assertProjectedCharsWithinBudget(projection.char_count, budget);
  } catch (err) {
    return {
      kind: 'REJECTED_INPUT',
      source_id: input.source_id,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const role = resolveDocumentRole({ sourceDeclared, callerDeclared, classified: ingested.classification });
  const structureKind = structureKindForRole(role.role);
  if (input.chunk_policy_version !== undefined && typeof input.chunk_policy_version !== 'string') {
    return {
      kind: 'REJECTED_INPUT',
      source_id: input.source_id,
      detail: 'chunk_policy_version must be a string label',
    };
  }
  const chunkPolicyVersion = input.chunk_policy_version ?? defaultChunkPolicyFor(structureKind);
  const textHash = projection.content_hash.value;
  const sourceProjectionRef = `sha256:${textHash}`;

  let chunks: readonly LegalChunk[] = [];
  let rejected: readonly RejectedFragment[] = [];
  let status: ProjectionStatus;
  let statusDetail: string | undefined;

  if (projection.char_count === 0) {
    // TEXT-L1 maps every zero-character outcome to extraction_status 'failed'. The step trail
    // still distinguishes "an extractor step failed" from "every step succeeded and there was
    // nothing to extract" — both are explicit, neither becomes empty-but-valid text.
    const anyStepFailed = projection.extraction.steps.some((s) => !s.succeeded);
    status = anyStepFailed ? 'EXTRACTION_FAILED' : 'EMPTY_TEXT';
    statusDetail = projection.extraction.steps
      .map(
        (s) => `${s.method}@${s.version}: ${s.succeeded ? 'ok' : 'failed'}${s.notes ? ` (${s.notes})` : ''}`,
      )
      .join('; ');
  } else {
    const admission = admitWithPolicy({
      chunkPolicyVersion,
      structureKind,
      text: projection.text,
      sourceProjectionRef,
      ...(structureKind === 'evidence'
        ? { evidenceDocType: role.evidence_doc_type ?? evidenceDocTypeForRole(role.role) ?? 'decision' }
        : {}),
    });
    chunks = admission.admitted;
    rejected = admission.rejected;
    status =
      admission.document_status === 'ADMITTED'
        ? 'PROJECTED'
        : admission.document_status === 'STRUCTURE_PARTIAL'
          ? 'STRUCTURE_PARTIAL'
          : 'NOT_ADMITTED';
    // Observability only (never identity): say WHY nothing / not everything was admitted. A real
    // document can extract fine and still yield zero chunks when the family chunker recognizes no
    // structure in it — that must be visible in coverage, not a silent 0.
    if (status === 'NOT_ADMITTED') {
      statusDetail =
        rejected[0]?.reason ??
        `no chunk admitted from ${projection.char_count} chars under ${chunkPolicyVersion} ` +
          `(structure kind '${structureKind}'): the chunker recognized no structure`;
    } else if (status === 'STRUCTURE_PARTIAL') {
      statusDetail = `${chunks.length} chunk(s) admitted, ${rejected.length} fragment(s) rejected: ${rejected[0]?.reason ?? 'unspecified'}`;
    }
  }

  const chunkSetContentHash = computeChunkSetContentHash(chunks);
  // K2.1b kernel input, unchanged. Two properties of that kernel are inherited here and reported,
  // not altered: (1) `registry_artifact_id` is identity-bearing, so a re-attestation relabel re-keys
  // every record (document_id stays); (2) a caller-declared evidence sub-type changes which
  // evidence chunker runs but is not part of this identity — the snapshot refuses two chunk sets
  // under one key (REJECT_IDENTITY_COLLISION), and the role's METHOD is carried into the read model.
  const materializationIdentity: LegalCorpusMaterializationIdentityInput = {
    logical_source_id: binding.source_id,
    registry_artifact_id: binding.registry_artifact_id,
    registry_source_content_hash: binding.registry_source_content_hash,
    raw_source_content_hash: rawSourceContentHash,
    text_projection_artifact_id: projection.projection_id,
    text_projection_hash: textHash,
    // Existing convention (every governed row so far): the identity slot carries the EXTRACTOR
    // version. Bound per document from the projection's own provenance, never retyped.
    text_projection_version: projection.extractor.version,
    corpus_materialization_version: CORPUS_MATERIALIZATION_VERSION,
    chunk_policy_version: chunkPolicyVersion,
  };
  const canonicalRecordKey = buildCanonicalLegalCorpusRecordKey(materializationIdentity);

  const provenanceChain: readonly ProvenanceLink[] = Object.freeze([
    {
      stage: 'SOURCE_REGISTRY',
      ref: `registry:${binding.registry_artifact_id}`,
      content_hash: binding.registry_source_content_hash,
      version: deps.catalog.origin,
      derived_from: null,
    },
    {
      stage: 'RAW_SOURCE',
      ref: source.ref.artifact_id,
      content_hash: rawSourceContentHash,
      version: 'sha256',
      derived_from: `registry:${binding.registry_artifact_id}`,
    },
    {
      stage: 'TEXT_PROJECTION',
      ref: projection.projection_id,
      content_hash: textHash,
      version: `${TEXT_PROJECTION_VERSION}/${projection.extractor.kind}@${projection.extractor.version}${projection.ocr_used ? `+ocr@${projection.ocr?.version ?? '?'}` : ''}`,
      derived_from: source.ref.artifact_id,
    },
    {
      stage: 'CHUNK_SET',
      ref: `chunkset:${chunkSetContentHash}`,
      content_hash: chunkSetContentHash,
      version: chunkPolicyVersion,
      derived_from: projection.projection_id,
    },
  ]);

  const document: CorpusDocumentProjection = Object.freeze({
    projection_version: KNOWLEDGE_CORPUS_PROJECTION_VERSION,
    document_id: documentId,
    source: binding,
    catalog_origin: deps.catalog.origin,
    doc_name: input.doc_name,
    ...(input.mime_type ? { mime_type: input.mime_type } : {}),
    byte_size: bytes.byteLength,
    raw_source_content_hash: rawSourceContentHash,
    text_projection: projection,
    text_projection_contract_version: TEXT_PROJECTION_VERSION,
    role,
    structure_kind: structureKind,
    chunk_policy_version: chunkPolicyVersion,
    chunks: Object.freeze([...chunks]),
    rejected_fragments: Object.freeze([...rejected]),
    chunk_set_content_hash: chunkSetContentHash,
    materialization_identity: Object.freeze({ ...materializationIdentity }),
    canonical_record_key: canonicalRecordKey,
    provenance_chain: provenanceChain,
    link_candidates: deriveLinkCandidates(role, chunks),
    status,
    ...(statusDetail ? { status_detail: statusDetail } : {}),
    ...(input.source_version_label ? { source_version_label: input.source_version_label } : {}),
    ...(input.acquisition ? { acquisition: copyAcquisition(input.acquisition) } : {}),
    version_lineage_key: lineageKey,
  });
  return { kind: 'PROJECTED', document };
}

/** Only the declared acquisition fields are carried; arbitrary keys (incl. a JSON-parsed own `__proto__`) never reach the frozen projection. */
function copyAcquisition(a: AcquisitionProvenance): AcquisitionProvenance {
  return Object.freeze({
    ...(a.quarantine_id !== undefined ? { quarantine_id: a.quarantine_id } : {}),
    ...(a.acquired_at !== undefined ? { acquired_at: a.acquired_at } : {}),
    ...(a.source_url !== undefined ? { source_url: a.source_url } : {}),
    ...(a.download_manifest_ref !== undefined
      ? {
          download_manifest_ref: Object.freeze({
            id: a.download_manifest_ref.id,
            content_hash: Object.freeze({
              algorithm: 'sha256' as const,
              digest: a.download_manifest_ref.content_hash.digest,
            }),
          }),
        }
      : {}),
    ...(a.archive_locator !== undefined ? { archive_locator: a.archive_locator } : {}),
  });
}

/** Locale-independent total order over strings (codepoint order); never `localeCompare`, whose result depends on the process ICU locale. */
export function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const LAW_CITATION = /\b(\d+(?:\s?[a-z])?)\s+kap\.\s+(\d+(?:\s?[a-z])?)\s*§/gi;
const STATUTE_REF =
  /\b(miljöbalken|plan-\s?och\s?bygglagen|miljöprövningsförordningen|avfallsförordningen)\b(?:\s*\((\d{4}:\d+)\))?/gi;
const MAX_LINK_CANDIDATES = 50;

/**
 * LINK-CANDIDATES-V1. Deterministic, rule-based, versioned, and explicitly NON-canonical. Two
 * rule families only: the evidence chunker's own relation rules (decision <-> control program /
 * MKB / technical description) and literal law-citation patterns ("N kap. M §", named statutes).
 * Nothing here is semantic similarity, and nothing here can become a canonical link.
 */
export function deriveLinkCandidates(
  role: DocumentRoleAssignment,
  chunks: readonly LegalChunk[],
): readonly LinkCandidate[] {
  const byKey = new Map<
    string,
    { relation: string; target: string; method: LinkCandidate['method']; fragments: Set<string> }
  >();
  const add = (relation: string, target: string, method: LinkCandidate['method'], fragmentId: string) => {
    const key = `${method}|${relation}|${target}`;
    const entry = byKey.get(key) ?? { relation, target, method, fragments: new Set<string>() };
    entry.fragments.add(fragmentId);
    byKey.set(key, entry);
  };

  const evidenceDocType = role.evidence_doc_type;
  for (const chunk of chunks) {
    if (chunk.structure_kind === 'evidence' && evidenceDocType) {
      for (const r of determineRelations(chunk.full_text, evidenceDocType, chunk.evidence_anchor ?? '')) {
        add(r.type, r.target, 'EVIDENCE_RELATION_RULES', chunk.fragment_id);
      }
    }
    for (const m of chunk.full_text.matchAll(LAW_CITATION)) {
      add(
        'cites',
        `law:${m[1]!.replace(/\s+/g, ' ')} kap. ${m[2]!.replace(/\s+/g, '')} §`,
        'LAW_CITATION_PATTERN',
        chunk.fragment_id,
      );
    }
    for (const m of chunk.full_text.matchAll(STATUTE_REF)) {
      add(
        'cites',
        `statute:${m[1]!.toLowerCase().replace(/\s+/g, ' ')}${m[2] ? ` (${m[2]})` : ''}`,
        'LAW_CITATION_PATTERN',
        chunk.fragment_id,
      );
    }
  }

  const candidates = [...byKey.values()]
    .map((e): LinkCandidate => ({
      relation: e.relation,
      target: e.target,
      method: e.method,
      rules_version: LINK_CANDIDATE_RULES_VERSION,
      confidence: e.method === 'EVIDENCE_RELATION_RULES' ? 'medium' : 'low',
      evidence_fragment_ids: Object.freeze([...e.fragments].sort()),
      canonical: false,
    }))
    .sort((a, b) =>
      codepointCompare(`${a.method}|${a.relation}|${a.target}`, `${b.method}|${b.relation}|${b.target}`),
    )
    .slice(0, MAX_LINK_CANDIDATES);
  return Object.freeze(candidates);
}

/**
 * Admitted = at least one governed chunk exists. STRUCTURE_PARTIAL is admitted: it is the honest
 * status of every real law document (a chapter heading preceding "1 §" is a fragment without a
 * verified paragraph marker and is rejected from the paragraph corpus by design), not a failure.
 */
export function isAdmittedProjection(document: CorpusDocumentProjection): boolean {
  return (
    (document.status === 'PROJECTED' || document.status === 'STRUCTURE_PARTIAL') && document.chunks.length > 0
  );
}

/** Content-addressed identity of one projection's replayable output (identities + provenance), for snapshot hashing. */
export function projectionFingerprint(document: CorpusDocumentProjection): string {
  return createHash('sha256')
    .update(
      canonicalizeStrict({
        document_id: document.document_id,
        canonical_record_key: document.canonical_record_key,
        chunk_set_content_hash: document.chunk_set_content_hash,
        role: document.role.role,
        status: document.status,
        provenance_chain: document.provenance_chain.map((l) => [l.stage, l.ref, l.content_hash, l.version]),
      }),
      'utf8',
    )
    .digest('hex');
}
