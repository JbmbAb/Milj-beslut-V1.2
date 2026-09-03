/**
 * GOVERNED-UI-LU-CUTOVER-01.
 *
 * Resolves governed DocumentEvidence V2 for a canonical property/context as LU input.
 * PropertyBinding V3 is the only cadastral admission signal. V1 document evidence remains
 * readable for historical replay elsewhere, but is not eligible as new governed LU input.
 *
 * Absence is an explicit coverage state. This module never mints evidence, never calls
 * DocumentEvidenceService, and never fabricates V1 artifacts.
 */
import type { ArtifactRepositoryPort } from "../../packages/mps-runtime/src/kernel/ExecutionKernel";
import { artifactCatalogOf } from "../../packages/mps-runtime/src/repository/ArtifactCatalog";
import type { DocumentEvidenceArtifact } from "../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifact";
import {
  isDocumentEvidenceV2,
  isDocumentEvidenceV2ContentHashValid,
  type DocumentEvidenceArtifactV2,
} from "../../packages/mps-lu/src/artifacts/DocumentEvidenceArtifactV2";
import {
  DOCUMENT_EVIDENCE_PROPERTY_BINDING_V3_ARTIFACT_ID_PREFIX,
  isDocumentEvidencePropertyBindingV3ContentHashValid,
  type DocumentEvidencePropertyBindingArtifactV3,
} from "../../packages/mps-lu/src/artifacts/DocumentEvidencePropertyBindingArtifactV3";

export const GOVERNED_DOCUMENT_EVIDENCE_SOURCE = "Styrkt dokumentbevisning";
export const NO_GOVERNED_DOCUMENT_EVIDENCE_DETAIL =
  "Ingen styrkt dokumentbevisning bunden till den valda fastigheten";
export const V1_NOT_ELIGIBLE_AS_NEW_LU_INPUT =
  "V1 document evidence is not eligible as new governed LU input";

export type GovernedDocumentEvidenceClientRef = {
  readonly artifact_id: string;
  readonly artifact_type: "DOCUMENT_EVIDENCE";
  readonly content_hash?: string;
  readonly property_binding_ref?: {
    readonly artifact_id: string;
    readonly artifact_type: "document_evidence_property_binding";
    readonly content_hash?: string;
  };
};

export type GovernedDocumentEvidenceCoverageStatus = "ok" | "unavailable";

export interface GovernedDocumentEvidenceCoverage {
  readonly source: typeof GOVERNED_DOCUMENT_EVIDENCE_SOURCE;
  readonly status: GovernedDocumentEvidenceCoverageStatus;
  readonly detail: string;
}

export interface GovernedDocumentEvidenceResolution {
  readonly evidence: readonly DocumentEvidenceArtifactV2[];
  readonly coverage: GovernedDocumentEvidenceCoverage;
  readonly warnings: readonly string[];
}

type AnyDocumentEvidence = DocumentEvidenceArtifact | DocumentEvidenceArtifactV2;

function isNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not found/i.test(msg);
}

async function resolveCanonicalV2Evidence(
  ref: GovernedDocumentEvidenceClientRef,
  expectedPropertyId: string,
  repository: ArtifactRepositoryPort,
): Promise<DocumentEvidenceArtifactV2 | "v1_ineligible"> {
  if (ref.artifact_type !== "DOCUMENT_EVIDENCE") {
    throw new Error(`REJECT_DOCUMENT_EVIDENCE: '${ref.artifact_id}' has the wrong artifact type`);
  }
  const canonical = await repository.resolve<AnyDocumentEvidence>({
    artifact_id: ref.artifact_id,
    artifact_type: ref.artifact_type,
  });
  if (canonical.artifact_id !== ref.artifact_id || canonical.artifact_type !== "DOCUMENT_EVIDENCE") {
    throw new Error(
      `REJECT_DOCUMENT_EVIDENCE: '${ref.artifact_id}' did not resolve to canonical DocumentEvidence`,
    );
  }
  if (ref.content_hash && canonical.content_hash.value !== ref.content_hash) {
    throw new Error(
      `REJECT_DOCUMENT_EVIDENCE: '${ref.artifact_id}' content_hash does not match the requested governed input`,
    );
  }

  if (!isDocumentEvidenceV2(canonical)) {
    return "v1_ineligible";
  }

  if (!ref.content_hash) {
    throw new Error(
      `REJECT_DOCUMENT_EVIDENCE_V2: '${ref.artifact_id}' requires a hash-bound content_hash`,
    );
  }
  if (!isDocumentEvidenceV2ContentHashValid(canonical)) {
    throw new Error(`REJECT_DOCUMENT_EVIDENCE_V2: '${ref.artifact_id}' content_hash is invalid`);
  }
  if (!ref.property_binding_ref) {
    throw new Error(
      `REJECT_DOCUMENT_EVIDENCE_V2: '${ref.artifact_id}' requires a property_binding_ref`,
    );
  }
  const binding = await repository.resolve<DocumentEvidencePropertyBindingArtifactV3>({
    artifact_id: ref.property_binding_ref.artifact_id,
    artifact_type: ref.property_binding_ref.artifact_type,
  });
  if (
    binding.artifact_id !== ref.property_binding_ref.artifact_id ||
    binding.artifact_type !== "document_evidence_property_binding" ||
    binding.payload.contract_version !== "document-evidence-property-binding-v3"
  ) {
    throw new Error(
      `REJECT_DOCUMENT_EVIDENCE_V2: '${ref.artifact_id}' did not resolve to a V3 property binding`,
    );
  }
  if (
    ref.property_binding_ref.content_hash &&
    binding.content_hash.value !== ref.property_binding_ref.content_hash
  ) {
    throw new Error(
      `REJECT_DOCUMENT_EVIDENCE_V2: property binding '${binding.artifact_id}' content_hash does not match the requested governed input`,
    );
  }
  if (!isDocumentEvidencePropertyBindingV3ContentHashValid(binding)) {
    throw new Error(
      `REJECT_DOCUMENT_EVIDENCE_V2: property binding '${binding.artifact_id}' content_hash is invalid`,
    );
  }
  if (
    binding.payload.document_evidence_ref.artifact_id !== canonical.artifact_id ||
    binding.payload.document_evidence_ref.artifact_type !== canonical.artifact_type ||
    binding.payload.document_evidence_ref.content_hash !== canonical.content_hash.value
  ) {
    throw new Error(
      `REJECT_DOCUMENT_EVIDENCE_V2: property binding '${binding.artifact_id}' is not bound to '${canonical.artifact_id}'`,
    );
  }
  if (
    binding.payload.property_ref.artifact_id !== expectedPropertyId ||
    binding.payload.property_ref.artifact_type !== "LU_PROPERTY_CONTEXT"
  ) {
    throw new Error(
      `REJECT_DOCUMENT_EVIDENCE_V2: property binding '${binding.artifact_id}' is not bound to '${expectedPropertyId}'`,
    );
  }
  if (
    JSON.stringify(binding.payload.verified_fact_refs) !==
    JSON.stringify(canonical.payload.verified_fact_refs)
  ) {
    throw new Error(
      `REJECT_DOCUMENT_EVIDENCE_V2: property binding '${binding.artifact_id}' verified_fact_refs do not match '${canonical.artifact_id}'`,
    );
  }
  return canonical;
}

function coverageFor(evidenceCount: number): GovernedDocumentEvidenceCoverage {
  if (evidenceCount === 0) {
    return {
      source: GOVERNED_DOCUMENT_EVIDENCE_SOURCE,
      status: "unavailable",
      detail: NO_GOVERNED_DOCUMENT_EVIDENCE_DETAIL,
    };
  }
  return {
    source: GOVERNED_DOCUMENT_EVIDENCE_SOURCE,
    status: "ok",
    detail: `${evidenceCount} styrkta dokumentbevis`,
  };
}

async function discoverPropertyScopedRefs(
  expectedPropertyId: string,
  repository: ArtifactRepositoryPort,
): Promise<readonly GovernedDocumentEvidenceClientRef[]> {
  const catalog = artifactCatalogOf(repository);
  if (!catalog) return [];

  const listed = await catalog.listArtifactIds();
  const ids = Array.isArray(listed) ? listed : [];
  const refs: GovernedDocumentEvidenceClientRef[] = [];
  for (const artifactId of ids) {
    if (!artifactId.startsWith(DOCUMENT_EVIDENCE_PROPERTY_BINDING_V3_ARTIFACT_ID_PREFIX)) {
      continue;
    }
    let binding: DocumentEvidencePropertyBindingArtifactV3;
    try {
      binding = await repository.resolve<DocumentEvidencePropertyBindingArtifactV3>({
        artifact_id: artifactId,
        artifact_type: "document_evidence_property_binding",
      });
    } catch (err) {
      if (isNotFoundError(err)) continue;
      throw err;
    }
    if (
      binding.artifact_type !== "document_evidence_property_binding" ||
      binding.payload?.contract_version !== "document-evidence-property-binding-v3"
    ) {
      continue;
    }
    if (binding.payload.property_ref.artifact_id !== expectedPropertyId) {
      continue;
    }
    if (binding.payload.property_ref.artifact_type !== "LU_PROPERTY_CONTEXT") {
      continue;
    }
    if (!isDocumentEvidencePropertyBindingV3ContentHashValid(binding)) {
      throw new Error(
        `REJECT_DOCUMENT_EVIDENCE_V2: property binding '${binding.artifact_id}' content_hash is invalid`,
      );
    }
    refs.push({
      artifact_id: binding.payload.document_evidence_ref.artifact_id,
      artifact_type: "DOCUMENT_EVIDENCE",
      content_hash: binding.payload.document_evidence_ref.content_hash,
      property_binding_ref: {
        artifact_id: binding.artifact_id,
        artifact_type: "document_evidence_property_binding",
        content_hash: binding.content_hash.value,
      },
    });
  }
  return refs;
}

/**
 * Resolves governed DocumentEvidence V2 for the selected canonical property.
 * Client refs remain an optional additional input (scripts/tests) but are never required
 * by LuWorkspace. V1 refs are skipped, not fabricated into kernel input.
 */
export async function resolveGovernedDocumentEvidenceForLuAssessment(args: {
  readonly propertyContextArtifactId: string;
  readonly documentEvidenceRefs?: readonly GovernedDocumentEvidenceClientRef[];
  readonly repository: ArtifactRepositoryPort;
}): Promise<GovernedDocumentEvidenceResolution> {
  const warnings: string[] = [];
  const discovered = await discoverPropertyScopedRefs(
    args.propertyContextArtifactId,
    args.repository,
  );
  const merged = new Map<string, GovernedDocumentEvidenceClientRef>();
  for (const ref of [...(args.documentEvidenceRefs ?? []), ...discovered]) {
    merged.set(ref.artifact_id, ref);
  }

  const evidenceById = new Map<string, DocumentEvidenceArtifactV2>();
  for (const ref of merged.values()) {
    const resolved = await resolveCanonicalV2Evidence(
      ref,
      args.propertyContextArtifactId,
      args.repository,
    );
    if (resolved === "v1_ineligible") {
      warnings.push(V1_NOT_ELIGIBLE_AS_NEW_LU_INPUT);
      continue;
    }
    evidenceById.set(resolved.artifact_id, resolved);
  }

  const evidence = [...evidenceById.values()];
  if (evidence.length === 0) {
    warnings.push(
      "Styrkt dokumentbevisning saknas för den valda fastigheten. V1-dokumentbevis genereras inte och är inte giltig ny LU-ingång.",
    );
  }
  return {
    evidence,
    coverage: coverageFor(evidence.length),
    warnings,
  };
}
