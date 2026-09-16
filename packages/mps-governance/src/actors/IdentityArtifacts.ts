import type { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract.js";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical.js";

export const HUMAN_IDENTITY_ARTIFACT_TYPE = "human_identity" as const;
export const HUMAN_IDENTITY_CONTRACT_VERSION = "human-identity-v1" as const;
export const HUMAN_IDENTITY_NAMESPACE = "mimer.user" as const;

export const SERVICE_IDENTITY_ARTIFACT_TYPE = "service_identity" as const;
export const SERVICE_IDENTITY_CONTRACT_VERSION = "service-identity-v1" as const;

export interface HumanIdentityArtifact extends ArtifactContract {
  readonly artifact_type: typeof HUMAN_IDENTITY_ARTIFACT_TYPE;
  /**
   * Canonical Mimer subject namespace. Authentication-provider identifiers
   * (BankID personal number, OIDC subject, etc.) are deliberately not identity.
   */
  readonly identity_namespace: typeof HUMAN_IDENTITY_NAMESPACE;
  /** Stable persisted Mimer User.id. Contains no role or authentication secret. */
  readonly subject_id: string;
  readonly contract_version: typeof HUMAN_IDENTITY_CONTRACT_VERSION;
}

export interface ServiceIdentityArtifact extends ArtifactContract {
  readonly artifact_type: typeof SERVICE_IDENTITY_ARTIFACT_TYPE;
  /** Stable logical namespace, e.g. "mimer.lu". */
  readonly service_namespace: string;
  /** Stable logical principal, never a runtime session/process id. */
  readonly principal_id: string;
  readonly contract_version: typeof SERVICE_IDENTITY_CONTRACT_VERSION;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`REJECT_CANONICAL_IDENTITY: ${field} is required`);
  return normalized;
}

function humanIdentityBody(input: {
  readonly subject_id: string;
}): Omit<HumanIdentityArtifact, "content_hash"> {
  const subjectId = required(input.subject_id, "subject_id");
  const identity = sha256ContentHash({
    artifact_type: HUMAN_IDENTITY_ARTIFACT_TYPE,
    identity_namespace: HUMAN_IDENTITY_NAMESPACE,
    subject_id: subjectId,
    contract_version: HUMAN_IDENTITY_CONTRACT_VERSION,
  });

  return {
    artifact_id: `human-identity-${identity.value.slice(0, 24)}`,
    artifact_type: HUMAN_IDENTITY_ARTIFACT_TYPE,
    references: [],
    identity_namespace: HUMAN_IDENTITY_NAMESPACE,
    subject_id: subjectId,
    contract_version: HUMAN_IDENTITY_CONTRACT_VERSION,
  };
}

/**
 * ADR-24-21 HumanIdentityArtifact implementation.
 *
 * The canonical subject is Mimer's persistent User.id. External authentication
 * identifiers are evidence used to bind a runtime principal to that subject,
 * never persisted in this artifact. This avoids embedding BankID personal
 * numbers (or reversibly enumerable hashes of them) in the canonical graph.
 *
 * This establishes identity only. It grants no role, capability, trust-domain
 * membership or mutation authority.
 */
export function createHumanIdentityArtifact(
  subjectId: string,
): HumanIdentityArtifact {
  const body = humanIdentityBody({ subject_id: subjectId });
  return {
    ...body,
    content_hash: sha256ContentHash(body),
  };
}

export function validateHumanIdentityArtifact(
  artifact: HumanIdentityArtifact,
): HumanIdentityArtifact {
  if (
    artifact.artifact_type !== HUMAN_IDENTITY_ARTIFACT_TYPE ||
    artifact.identity_namespace !== HUMAN_IDENTITY_NAMESPACE ||
    artifact.contract_version !== HUMAN_IDENTITY_CONTRACT_VERSION
  ) {
    throw new Error("REJECT_CANONICAL_HUMAN_IDENTITY: contract mismatch");
  }

  const rebuiltBody = humanIdentityBody({
    subject_id: artifact.subject_id,
  });
  const rebuiltHash = sha256ContentHash(rebuiltBody);
  if (
    artifact.artifact_id !== rebuiltBody.artifact_id ||
    artifact.content_hash?.algorithm !== rebuiltHash.algorithm ||
    artifact.content_hash?.value !== rebuiltHash.value
  ) {
    throw new Error("REJECT_CANONICAL_HUMAN_IDENTITY: canonical identity mismatch");
  }
  return artifact;
}

function serviceIdentityBody(input: {
  readonly service_namespace: string;
  readonly principal_id: string;
}): Omit<ServiceIdentityArtifact, "content_hash"> {
  const serviceNamespace = required(input.service_namespace, "service_namespace");
  const principalId = required(input.principal_id, "principal_id");
  const identity = sha256ContentHash({
    artifact_type: SERVICE_IDENTITY_ARTIFACT_TYPE,
    service_namespace: serviceNamespace,
    principal_id: principalId,
    contract_version: SERVICE_IDENTITY_CONTRACT_VERSION,
  });

  return {
    artifact_id: `service-identity-${identity.value.slice(0, 24)}`,
    artifact_type: SERVICE_IDENTITY_ARTIFACT_TYPE,
    references: [],
    service_namespace: serviceNamespace,
    principal_id: principalId,
    contract_version: SERVICE_IDENTITY_CONTRACT_VERSION,
  };
}

/**
 * ADR-24-21 ServiceIdentityArtifact implementation for a stable logical
 * principal. Runtime process ids, hostnames and session ids must never be used.
 *
 * Identity is deliberately separate from the issuer/delegation that authorizes
 * the service principal.
 */
export function createServiceIdentityArtifact(input: {
  readonly service_namespace: string;
  readonly principal_id: string;
}): ServiceIdentityArtifact {
  const body = serviceIdentityBody(input);
  return {
    ...body,
    content_hash: sha256ContentHash(body),
  };
}

export function validateServiceIdentityArtifact(
  artifact: ServiceIdentityArtifact,
): ServiceIdentityArtifact {
  if (
    artifact.artifact_type !== SERVICE_IDENTITY_ARTIFACT_TYPE ||
    artifact.contract_version !== SERVICE_IDENTITY_CONTRACT_VERSION
  ) {
    throw new Error("REJECT_CANONICAL_SERVICE_IDENTITY: contract mismatch");
  }

  const rebuiltBody = serviceIdentityBody({
    service_namespace: artifact.service_namespace,
    principal_id: artifact.principal_id,
  });
  const rebuiltHash = sha256ContentHash(rebuiltBody);
  if (
    artifact.artifact_id !== rebuiltBody.artifact_id ||
    artifact.content_hash?.algorithm !== rebuiltHash.algorithm ||
    artifact.content_hash?.value !== rebuiltHash.value
  ) {
    throw new Error("REJECT_CANONICAL_SERVICE_IDENTITY: canonical identity mismatch");
  }
  return artifact;
}
