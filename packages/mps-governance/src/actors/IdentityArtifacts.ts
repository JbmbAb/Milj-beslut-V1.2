import type { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash.js";
import { sha256ContentHash } from "../../../mps-compliance/src/canonical/sha256Canonical.js";

export const HUMAN_IDENTITY_ARTIFACT_TYPE = "human_identity" as const;
export const HUMAN_IDENTITY_CONTRACT_VERSION = "human-identity-v1" as const;
export const HUMAN_IDENTITY_PROVIDER_BANKID = "BANKID" as const;

export const SERVICE_IDENTITY_ARTIFACT_TYPE = "service_identity" as const;
export const SERVICE_IDENTITY_CONTRACT_VERSION = "service-identity-v1" as const;

export interface HumanIdentityArtifact extends ArtifactContract {
  readonly artifact_type: typeof HUMAN_IDENTITY_ARTIFACT_TYPE;
  readonly identity_provider: typeof HUMAN_IDENTITY_PROVIDER_BANKID;
  /**
   * Domain-separated fingerprint of the provider subject.
   * The raw BankID subject is deliberately not persisted in the canonical artifact.
   */
  readonly subject_fingerprint: ContentHash;
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

function humanSubjectFingerprint(bankidSubject: string): ContentHash {
  return sha256ContentHash({
    identity_contract: HUMAN_IDENTITY_CONTRACT_VERSION,
    identity_provider: HUMAN_IDENTITY_PROVIDER_BANKID,
    provider_subject: required(bankidSubject, "bankid_subject"),
  });
}

function humanIdentityBody(input: {
  readonly subject_fingerprint: ContentHash;
}): Omit<HumanIdentityArtifact, "content_hash"> {
  const fingerprint = input.subject_fingerprint;
  const identity = sha256ContentHash({
    artifact_type: HUMAN_IDENTITY_ARTIFACT_TYPE,
    identity_provider: HUMAN_IDENTITY_PROVIDER_BANKID,
    subject_fingerprint: fingerprint,
    contract_version: HUMAN_IDENTITY_CONTRACT_VERSION,
  });

  return {
    artifact_id: `human-identity-bankid-${identity.value.slice(0, 24)}`,
    artifact_type: HUMAN_IDENTITY_ARTIFACT_TYPE,
    references: [],
    identity_provider: HUMAN_IDENTITY_PROVIDER_BANKID,
    subject_fingerprint: fingerprint,
    contract_version: HUMAN_IDENTITY_CONTRACT_VERSION,
  };
}

/**
 * ADR-24-21 HumanIdentityArtifact implementation for an already authenticated
 * BankID subject.
 *
 * This function establishes identity only. It grants no role, capability,
 * trust-domain membership or mutation authority.
 */
export function createHumanIdentityArtifactFromBankId(
  bankidSubject: string,
): HumanIdentityArtifact {
  const body = humanIdentityBody({
    subject_fingerprint: humanSubjectFingerprint(bankidSubject),
  });
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
    artifact.identity_provider !== HUMAN_IDENTITY_PROVIDER_BANKID ||
    artifact.contract_version !== HUMAN_IDENTITY_CONTRACT_VERSION
  ) {
    throw new Error("REJECT_CANONICAL_HUMAN_IDENTITY: contract mismatch");
  }
  if (
    artifact.subject_fingerprint?.algorithm !== "sha256" ||
    !artifact.subject_fingerprint.value
  ) {
    throw new Error("REJECT_CANONICAL_HUMAN_IDENTITY: invalid subject fingerprint");
  }

  const rebuiltBody = humanIdentityBody({
    subject_fingerprint: artifact.subject_fingerprint,
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
