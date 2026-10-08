import { isDeclaredStrongEtagAuthority } from "./DownloadTargetResolvers";
import type { StrongEtagAuthorityBinding } from "./GovernedDownloadContracts";
import {
  BindingStoreUnreadable,
  type ValidatorBindingRecord,
  type ValidatorBindingStore,
  type ValidatorClass,
} from "./ValidatorBindingStore";

/**
 * L-V0 prefetch decision.
 *
 * SKIP is only the closed strong-ETag path. Every other case is FETCH.
 * Local hashes, manifests, CAS and quarantine are not inputs to that path.
 *
 * The executor calls this function. Production resolvers do not declare
 * STRONG_ETAG, so a production run returns before any exchange. V0 exchange
 * is HEAD only. This function verifies authority and does not mint it.
 * A 200 body is not a decision payload.
 *
 * `failure: "unsupported"` is mapped before status, final URL, ETag, or body.
 * That mapping is outside the scoped strong-ETag authority proof.
 */

export type PrefetchDecisionKind = "SKIP" | "FETCH";

export type PrefetchReasonCode =
  | "REMOTE_REPRESENTATION_UNCHANGED"
  | "NO_PRIOR_BOUND_TOKEN"
  | "SIGNAL_UNVERIFIABLE"
  | "SIGNAL_CLASS_FORBIDDEN"
  | "SIGNAL_MISSING"
  | "BINDING_MISMATCH"
  | "LOCAL_NON_AUTHORITY"
  | "VALIDATOR_EXCHANGE_UNSUPPORTED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_UNAUTHORIZED"
  | "SCOPE_VIOLATION"
  | "RESUME_UNSUPPORTED"
  | "REPRESENTATION_CHANGED";

export interface PrefetchTargetRequest {
  readonly sourceId: string;
  readonly sourceContentHash: string;
  readonly registryArtifactId: string;
  readonly adapterId: string;
  readonly strongEtagAuthority: StrongEtagAuthorityBinding | null;
  readonly changeDetectionStrategy?: "ETAG" | "LAST_MODIFIED" | "CONTENT_HASH" | "NONE";
  readonly locatorIdentity: string;
  readonly targetIdentity: string;
  readonly fileName?: string;
  readonly fileNameDeclared: boolean;
  readonly validatorClass: ValidatorClass;
  readonly method: "HEAD";
  readonly performLiveExchange: boolean;
  readonly localContentHash?: string;
  readonly downloadManifestDigest?: string;
  readonly casHash?: string;
  readonly quarantineHash?: string;
  readonly sniffedEtag?: string;
}

export interface PrefetchDecisionResult {
  readonly decision: PrefetchDecisionKind;
  readonly reasonCode: PrefetchReasonCode;
}

export interface ConditionalExchangeRequest {
  readonly method: "HEAD";
  readonly locatorIdentity: string;
  readonly ifNoneMatch: string;
}

export interface ConditionalExchangeResponse {
  readonly finalUrl: string;
  readonly status: number;
  readonly etag: string | null;
  readonly body?: Uint8Array;
  readonly failure?: "unavailable" | "unauthorized" | "scope" | "unsupported";
}

export interface ConditionalValidatorExchange {
  exchange(request: ConditionalExchangeRequest): Promise<ConditionalExchangeResponse>;
}

export async function decidePrefetch(
  request: PrefetchTargetRequest,
  store: ValidatorBindingStore,
  exchange: ConditionalValidatorExchange | null,
  clock: () => string,
): Promise<PrefetchDecisionResult> {
  void request.changeDetectionStrategy;
  void request.localContentHash;
  void request.downloadManifestDigest;
  void request.casHash;
  void request.quarantineHash;
  void request.sniffedEtag;

  if (request.validatorClass !== "STRONG_ETAG") {
    return fetch("SIGNAL_CLASS_FORBIDDEN");
  }

  if (!isDeclaredStrongEtagAuthority(request.strongEtagAuthority)) {
    return fetch("SIGNAL_CLASS_FORBIDDEN");
  }

  const authority = request.strongEtagAuthority;
  if (authority.sourceId !== request.sourceId) {
    return fetch("SIGNAL_CLASS_FORBIDDEN");
  }
  if (authority.sourceContentHash !== request.sourceContentHash) {
    return fetch("SIGNAL_CLASS_FORBIDDEN");
  }
  if (authority.registryArtifactId !== request.registryArtifactId) {
    return fetch("SIGNAL_CLASS_FORBIDDEN");
  }
  if (authority.adapterId !== request.adapterId) {
    return fetch("SIGNAL_CLASS_FORBIDDEN");
  }
  if (authority.locatorIdentity !== request.locatorIdentity) {
    return fetch("SIGNAL_CLASS_FORBIDDEN");
  }
  if (authority.targetIdentity !== request.targetIdentity) {
    return fetch("SIGNAL_CLASS_FORBIDDEN");
  }

  let records: readonly ValidatorBindingRecord[];
  try {
    records = await store.resolve(
      request.sourceId,
      request.locatorIdentity,
      request.targetIdentity,
    );
  } catch (error) {
    if (error instanceof BindingStoreUnreadable) {
      return fetch("SIGNAL_UNVERIFIABLE");
    }
    throw error;
  }
  if (records.length === 0) {
    return fetch("NO_PRIOR_BOUND_TOKEN");
  }
  if (records.length !== 1) {
    return fetch("SIGNAL_UNVERIFIABLE");
  }

  const record = records[0];
  if (record === undefined) {
    return fetch("SIGNAL_UNVERIFIABLE");
  }

  if (request.sourceId !== record.sourceId || request.registryArtifactId !== record.registryArtifactId) {
    return fetch("BINDING_MISMATCH");
  }

  if (request.sourceContentHash !== record.sourceContentHash) {
    return fetch("BINDING_MISMATCH");
  }

  if (request.locatorIdentity !== record.locatorIdentity) {
    return fetch("BINDING_MISMATCH");
  }

  if (request.targetIdentity !== record.targetIdentity) {
    return fetch("BINDING_MISMATCH");
  }

  if (request.fileNameDeclared && request.fileName !== record.fileName) {
    return fetch("BINDING_MISMATCH");
  }

  if (!isSingleStrongToken(record.validatorToken) || record.validatorClass !== "STRONG_ETAG") {
    return fetch("SIGNAL_UNVERIFIABLE");
  }

  if (request.method !== "HEAD") {
    return fetch("VALIDATOR_EXCHANGE_UNSUPPORTED");
  }

  if (!request.performLiveExchange || exchange === null) {
    return fetch("VALIDATOR_EXCHANGE_UNSUPPORTED");
  }

  let response: ConditionalExchangeResponse;
  try {
    response = await exchange.exchange({
      method: "HEAD",
      locatorIdentity: request.locatorIdentity,
      ifNoneMatch: record.validatorToken,
    });
  } catch {
    return fetch("UPSTREAM_UNAVAILABLE");
  }

  if (response.failure === "unsupported") {
    return fetch("VALIDATOR_EXCHANGE_UNSUPPORTED");
  }

  if (response.failure === "unavailable" || response.status >= 500) {
    return fetch("UPSTREAM_UNAVAILABLE");
  }
  if (response.failure === "unauthorized" || response.status === 401 || response.status === 403) {
    return fetch("UPSTREAM_UNAUTHORIZED");
  }
  if (response.failure === "scope") {
    return fetch("SCOPE_VIOLATION");
  }
  if (response.status === 206) {
    return fetch("RESUME_UNSUPPORTED");
  }

  if (response.finalUrl !== request.locatorIdentity) {
    return fetch("BINDING_MISMATCH");
  }

  if (response.status === 304) {
    if (response.etag === null || response.etag === "") {
      return fetch("SIGNAL_MISSING");
    }
    if (response.etag !== record.validatorToken || !isSingleStrongToken(response.etag)) {
      return fetch("SIGNAL_UNVERIFIABLE");
    }
    const recorded = await store.touchObservedAt(
      request.sourceId,
      request.locatorIdentity,
      request.targetIdentity,
      clock(),
      record.validatorToken,
    );
    if (!recorded) {
      return fetch("SIGNAL_UNVERIFIABLE");
    }
    return { decision: "SKIP", reasonCode: "REMOTE_REPRESENTATION_UNCHANGED" };
  }

  if (response.status === 200) {
    return fetch("REPRESENTATION_CHANGED");
  }

  return fetch("SIGNAL_UNVERIFIABLE");
}

export function isSingleStrongToken(token: string): boolean {
  return token.length > 0 && !token.startsWith("W/") && !token.includes(",");
}

function fetch(reasonCode: PrefetchReasonCode): PrefetchDecisionResult {
  return { decision: "FETCH", reasonCode };
}
