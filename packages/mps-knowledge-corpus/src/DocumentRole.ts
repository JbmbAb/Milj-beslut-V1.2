import {
  DOCUMENT_CLASSIFIER_VERSION,
  type DocumentClass,
  type DocumentClassification,
} from '@miljobeslut/mps-text-projection';
import type { ChunkStructureKind } from '@miljobeslut/mps-legal-corpus';

import type { AuthorizedSourceBinding } from './SourceAuthority';
import { SOURCE_ROLE_MAPPING_VERSION } from './versions';

/**
 * Document role = the repo's existing canonical routing vocabulary (`DocumentClass` from
 * mps-text-projection: law | court | evidence_decision | evidence_mkb | evidence_technical |
 * evidence_control | standard | unknown). No synonyms are introduced; `unknown` is the explicit
 * "we do not know" value, never a silent default to something else.
 */
export type DocumentRole = DocumentClass;

export type RoleDerivationMethod =
  /** Mapped deterministically from what the SIGNED registry entry declares the source yields. Authority-backed. */
  | 'SOURCE_DECLARED'
  /** An explicit, recorded hint from the caller's own governed manifest (e.g. an archive family label). Not authority. */
  | 'CALLER_DECLARED'
  /** mps-text-projection's deterministic heuristic classifier. DERIVED — never a source fact. */
  | 'DETERMINISTIC_CLASSIFIER';

export interface DocumentRoleAssignment {
  readonly role: DocumentRole;
  readonly method: RoleDerivationMethod;
  /** Which versioned rule produced it: the mapping table, or the classifier id+version. */
  readonly rule_id: string;
  readonly rule_version: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly reasons: readonly string[];
  /** The evidence document family when role is evidence_* (decision | mkb | technical_description | control_program). */
  readonly evidence_doc_type?: string;
}

const EVIDENCE_DOC_TYPE_BY_ROLE: Readonly<Partial<Record<DocumentRole, string>>> = Object.freeze({
  evidence_decision: 'decision',
  evidence_mkb: 'mkb',
  evidence_technical: 'technical_description',
  evidence_control: 'control_program',
});

export function evidenceDocTypeForRole(role: DocumentRole): string | undefined {
  return EVIDENCE_DOC_TYPE_BY_ROLE[role];
}

/**
 * SOURCE-ROLE-MAPPING-V1. Maps the registry entry's declared `artifact_types` (+ adapter/authority
 * type where the artifact type alone is ambiguous) to a role. Returns null when the declaration
 * describes something this text corpus cannot represent (REFERENCE_DATASET, SPATIAL_DATASET) so the
 * caller classifies the document UNSUPPORTED_ARTIFACT_TYPE instead of guessing a text role.
 *
 * Exact declarations present in source-registry/national-registry.json at K2.2's base:
 *   LAW, ORDINANCE, AGENCY_GUIDANCE, AGENCY_GENERAL_ADVICE, decision, REFERENCE_DATASET, SPATIAL_DATASET.
 */
export function roleFromSourceDeclaration(binding: AuthorizedSourceBinding): DocumentRoleAssignment | null {
  const types = new Set(binding.artifact_types.map((t) => t.toUpperCase()));
  const reasons: string[] = [`registry artifact_types=${JSON.stringify(binding.artifact_types)}`];

  if (types.has('LAW') || types.has('ORDINANCE')) {
    return assignment('law', reasons);
  }
  if (types.has('DECISION')) {
    if (binding.adapter === 'PUH_RATTSPRAXIS_V1' || binding.authority_type === 'court') {
      reasons.push(`adapter=${binding.adapter}, authority_type=${binding.authority_type} -> court decision`);
      return assignment('court', reasons);
    }
    reasons.push(`authority_type=${binding.authority_type} -> permit/supervision decision (evidence family)`);
    return assignment('evidence_decision', reasons, 'decision');
  }
  if (types.has('AGENCY_GUIDANCE') || types.has('AGENCY_GENERAL_ADVICE')) {
    reasons.push('agency guidance / general advice has no law/court structure -> standard');
    return assignment('standard', reasons);
  }
  return null;
}

function assignment(role: DocumentRole, reasons: string[], evidenceDocType?: string): DocumentRoleAssignment {
  return Object.freeze({
    role,
    method: 'SOURCE_DECLARED',
    rule_id: 'mps-knowledge-corpus/roleFromSourceDeclaration',
    rule_version: SOURCE_ROLE_MAPPING_VERSION,
    confidence: 'high',
    reasons: Object.freeze([...reasons]),
    ...(evidenceDocType ? { evidence_doc_type: evidenceDocType } : {}),
  });
}

export function roleFromClassifier(classification: DocumentClassification): DocumentRoleAssignment {
  return Object.freeze({
    role: classification.document_class,
    method: 'DETERMINISTIC_CLASSIFIER',
    rule_id: 'mps-text-projection/classifyDocument',
    rule_version: classification.classifier_version ?? DOCUMENT_CLASSIFIER_VERSION,
    confidence: classification.confidence,
    reasons: Object.freeze([...classification.reasons]),
    ...(classification.evidence_doc_type ? { evidence_doc_type: classification.evidence_doc_type } : {}),
  });
}

export const DOCUMENT_ROLES: readonly DocumentRole[] = Object.freeze([
  'law',
  'court',
  'evidence_decision',
  'evidence_mkb',
  'evidence_technical',
  'evidence_control',
  'standard',
  'unknown',
]);

/** Runtime guard for caller-supplied roles: a string that merely LOOKS like a role is refused, never admitted. */
export function isDocumentRole(value: unknown): value is DocumentRole {
  return typeof value === 'string' && (DOCUMENT_ROLES as readonly string[]).includes(value);
}

export function roleFromCallerDeclaration(role: DocumentRole, reason: string): DocumentRoleAssignment {
  if (!isDocumentRole(role)) throw new TypeError(`'${String(role)}' is not a document role`);
  const evidenceDocType = evidenceDocTypeForRole(role);
  return Object.freeze({
    role,
    method: 'CALLER_DECLARED',
    rule_id: 'caller-declared',
    rule_version: SOURCE_ROLE_MAPPING_VERSION,
    confidence: 'medium',
    reasons: Object.freeze([reason]),
    ...(evidenceDocType ? { evidence_doc_type: evidenceDocType } : {}),
  });
}

/**
 * Precedence: what the signed registry declares > what the caller's governed manifest declares >
 * what the heuristic classifier derives. A derived role can refine a declared one only inside the
 * same family (e.g. registry says `decision` for a municipal archive, caller says which evidence
 * sub-type) — it can never overturn it.
 */
export function resolveDocumentRole(args: {
  readonly sourceDeclared: DocumentRoleAssignment | null;
  readonly callerDeclared?: DocumentRoleAssignment;
  readonly classified: DocumentClassification;
}): DocumentRoleAssignment {
  if (args.sourceDeclared) {
    if (
      args.callerDeclared &&
      args.sourceDeclared.role === 'evidence_decision' &&
      args.callerDeclared.role.startsWith('evidence_')
    ) {
      return Object.freeze({
        ...args.callerDeclared,
        reasons: Object.freeze([...args.sourceDeclared.reasons, ...args.callerDeclared.reasons]),
      });
    }
    if (args.callerDeclared) {
      // Source wins; the discarded declaration is RECORDED, never silently dropped.
      return Object.freeze({
        ...args.sourceDeclared,
        reasons: Object.freeze([
          ...args.sourceDeclared.reasons,
          `caller declared '${args.callerDeclared.role}' ignored: outside the evidence-family refinement rule (source-declared '${args.sourceDeclared.role}' wins)`,
        ]),
      });
    }
    return args.sourceDeclared;
  }
  if (args.callerDeclared) return args.callerDeclared;
  return roleFromClassifier(args.classified);
}

/** Role -> the chunking family that owns its structural identity (ChunkIdentity v2). */
export function structureKindForRole(role: DocumentRole): ChunkStructureKind {
  switch (role) {
    case 'law':
      return 'law';
    case 'court':
      return 'court';
    case 'evidence_decision':
    case 'evidence_mkb':
    case 'evidence_technical':
    case 'evidence_control':
      return 'evidence';
    case 'standard':
    case 'unknown':
      return 'standard';
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}
