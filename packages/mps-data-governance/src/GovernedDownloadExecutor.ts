import { createHash } from "node:crypto";

import {
  isStreamingQuarantineStorage,
  StreamingQuarantineError,
  type QuarantineStorage,
  type StreamingQuarantinePutSession,
  type StreamingQuarantineStorage,
} from "@miljobeslut/mimers-brunn-core";

import { isDeclaredStrongEtagAuthority } from "./DownloadTargetResolvers";
import { buildDownloadManifestRef } from "./DownloadManifestIdentity";
import type { DownloadManifestStore } from "./DownloadManifestStore";
import {
  buildPrefetchEvidenceRef,
  InMemoryPrefetchExecutionEvidenceStore,
  type PrefetchExecutionEvidence,
  type PrefetchExecutionEvidenceStore,
  type PrefetchOutcome,
} from "./PrefetchExecutionEvidence";
import {
  decidePrefetch,
  isSingleStrongToken,
  type ConditionalValidatorExchange,
} from "./PrefetchValidator";
import { InMemoryValidatorBindingStore, type ValidatorBindingStore } from "./ValidatorBindingStore";

import type { ContentReference } from "../../mps-core/src/types";
import type {
  Clock,
  HarvestExecutionOutcome,
  HarvestExecutor,
} from "./HarvestOrchestratorContracts";
import type { HarvestExecutionRequest } from "./HarvestOrchestratorTypes";
import {
  isUrlAllowedForVerifiedSource,
  type VerifiedSourceRegistry,
} from "./SourceRegistry";
import {
  GovernedDownloadError,
  type NoChangesEvidence,
  type DownloadTarget,
  type DownloadTargetResolver,
  type DownloadTransport,
  type DownloadManifest,
  type DownloadedObject,
} from "./GovernedDownloadContracts";
import {
  isStreamingDownloadTransport,
  type StreamingDownloadBody,
  type StreamingDownloadTransport,
  type StreamingHeaderResponse,
} from "./StreamingDownloadBody";

export interface GovernedDownloadWiring {
  readonly bindingStore?: ValidatorBindingStore;
  readonly headExchange?: ConditionalValidatorExchange | null;
  readonly prefetchEvidenceStore?: PrefetchExecutionEvidenceStore;
}

/**
 * P2 — Governed download pipeline.
 *
 * Implements the existing `HarvestExecutor` port, so the orchestrator keeps the state machine,
 * checkpointing, quarantine transitions and import gate. This class does exactly one stage:
 * turn an approved source into quarantined bytes plus a provenance manifest.
 *
 * It CANNOT promote anything. It holds no CAS repository, no import gate and no signing key —
 * promotion authority is absent by construction rather than by discipline.
 */
/**
 * Deadline for response headers, and the maximum silence allowed between body chunks.
 * It is not a budget for the whole transfer. A body that keeps producing chunks may
 * run longer than this. A stall of this length aborts that attempt.
 */
export const STREAMING_HEADER_AND_IDLE_TIMEOUT_MS = 30_000;

export class GovernedDownloadExecutor implements HarvestExecutor {
  constructor(
    private readonly registry: VerifiedSourceRegistry,
    private readonly resolver: DownloadTargetResolver,
    private readonly transport: DownloadTransport,
    private readonly quarantine: QuarantineStorage,
    private readonly manifestStore: DownloadManifestStore,
    private readonly clock: Clock,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly wiring: GovernedDownloadWiring = {},
  ) {}

  async execute(request: HarvestExecutionRequest): Promise<HarvestExecutionOutcome> {
    const sourceId = request.dataset_ref.id;

    // The registry is the authority. It only yields sources that carried a verified APPROVED
    // attestation, so an unknown id here means "not approved or not registered" — both of
    // which must stop the run rather than fall back to fetching anyway.
    const source = this.registry.getSource(sourceId);
    if (!source) {
      throw new GovernedDownloadError(
        `REJECT_SOURCE: '${sourceId}' is not an approved source in the verified registry.`,
        "REJECT_SOURCE",
      );
    }

    if (source.channelType === "ARCHIVE_IMPORT") {
      throw new GovernedDownloadError(
        `REJECT_ARCHIVE_IMPORT_NETWORK_HARVEST: source '${sourceId}' may enter only through an explicit governed archive import operation.`,
        "REJECT_ARCHIVE_IMPORT_NETWORK_HARVEST",
      );
    }

    const plan = await this.resolver.resolve({
      source_id: sourceId,
      execution_id: request.execution_id,
    });

    // P2-EMPTY-PLAN-01. Two kinds of nothing, told apart by what the resolver claims to have
    // seen — never by which adapter produced it. There is deliberately no source_id or adapter
    // branch here: the moment the executor knows one source is allowed to come back empty, the
    // rule stops being a rule.
    if (plan.kind === "NO_CHANGES") {
      assertNoChangesEvidence(plan.evidence, sourceId);

      return {
        kind: "DOWNLOAD_MANIFEST",
        ref: await this.persistManifest({
          manifest_version: 1,
          execution_id: request.execution_id,
          source_id: sourceId,
          source_content_hash: source.sourceContentHash,
          registry_artifact_id: source.registryArtifactId,
          objects: [],
          no_changes: plan.evidence,
          generated_at: this.clock.now(),
        }),
      };
    }

    const targets = plan.targets;

    if (targets.length === 0) {
      throw new GovernedDownloadError(
        `REJECT_EMPTY_PLAN: source '${sourceId}' resolved to no targets and did not report a ` +
          "verified no-change observation. An empty download is indistinguishable from a " +
          "silently failed one, so it is refused rather than manifested as a successful run " +
          "of nothing.",
        "REJECT_EMPTY_PLAN",
      );
    }

    // Every URL is validated BEFORE any request is issued. Validating lazily would mean the
    // first out-of-scope URL is only caught after earlier ones were already fetched.
    for (const target of targets) {
      if (!isUrlAllowedForVerifiedSource(source, target.url)) {
        throw new GovernedDownloadError(
          `REJECT_URL_SCOPE: '${target.url}' is outside the allowed domains for source ` +
            `'${sourceId}' (${source.allowedDomains.join(", ")}).`,
          "REJECT_URL_SCOPE",
        );
      }
    }

    const bindingStore = this.wiring.bindingStore ?? new InMemoryValidatorBindingStore();
    const evidenceStore = this.wiring.prefetchEvidenceStore ?? new InMemoryPrefetchExecutionEvidenceStore();
    const outcomes: PrefetchOutcome[] = [];
    const fetched: DownloadedObject[] = [];
    let issued = 0;
    const beforeOutbound = async () => {
      if (issued > 0) await this.applyPoliteness(source.policy);
      issued += 1;
    };
    const headExchange = this.wiring.headExchange ?? null;
    const exchange: ConditionalValidatorExchange | null =
      headExchange === null
        ? null
        : {
            exchange: async (headRequest) => {
              await beforeOutbound();
              return headExchange.exchange(headRequest);
            },
          };

    for (const target of targets) {
      const targetIdentity = target.targetIdentity ?? `${target.url}\n${target.file_name}`;
      const decision = await decidePrefetch(
        {
          sourceId: source.sourceId,
          sourceContentHash: source.sourceContentHash,
          registryArtifactId: source.registryArtifactId,
          adapterId: source.adapter,
          strongEtagAuthority: target.strongEtagAuthority ?? null,
          locatorIdentity: target.url,
          targetIdentity,
          fileName: target.file_name,
          fileNameDeclared: true,
          validatorClass: "STRONG_ETAG",
          method: "HEAD",
          performLiveExchange: exchange !== null,
        },
        bindingStore,
        exchange,
        () => this.clock.now(),
      );

      if (
        decision.decision === "FETCH" &&
        (decision.reasonCode === "SCOPE_VIOLATION" || decision.reasonCode === "UPSTREAM_UNAUTHORIZED")
      ) {
        throw new GovernedDownloadError(
          `${decision.reasonCode}: '${target.url}' stopped the harvest before a body request.`,
          decision.reasonCode,
        );
      }

      if (decision.decision === "SKIP") {
        const records = await bindingStore.resolve(source.sourceId, target.url, targetIdentity);
        const record = records.length === 1 ? records[0] : undefined;
        if (record === undefined) {
          throw new GovernedDownloadError(
            `REJECT_PREFETCH_EVIDENCE: SKIP for '${target.url}' has no single binding to cite.`,
            "REJECT_PREFETCH_EVIDENCE",
          );
        }
        outcomes.push({
          outcome: "SKIP",
          target_identity: targetIdentity,
          locator_identity: target.url,
          file_name: target.file_name,
          method: "HEAD",
          reason_code: "REMOTE_REPRESENTATION_UNCHANGED",
          validator_class: "STRONG_ETAG",
          validator_token: record.validatorToken,
          final_url: target.url,
          observed_at: record.observedAt,
        });
        continue;
      }

      const landed = await this.fetchOne(source, target, beforeOutbound);
      await this.maybeReplaceBinding(bindingStore, source, target, targetIdentity, landed.response);
      fetched.push(landed.object);
      outcomes.push({
        outcome: "FETCH",
        target_identity: targetIdentity,
        locator_identity: target.url,
        file_name: landed.object.file_name,
        quarantine_id: landed.object.quarantine_id,
        content_hash: landed.object.content_hash,
        byte_length: landed.object.byte_length,
      });
    }

    if (outcomes.length !== targets.length) {
      throw new GovernedDownloadError(
        `REJECT_PREFETCH_EVIDENCE: source '${sourceId}' produced ${outcomes.length} outcomes for ` +
          `${targets.length} targets.`,
        "REJECT_PREFETCH_EVIDENCE",
      );
    }

    const skipped = outcomes.some((outcome) => outcome.outcome === "SKIP");
    if (!skipped) {
      return {
        kind: "DOWNLOAD_MANIFEST",
        ref: await this.persistManifest({
          manifest_version: 1,
          execution_id: request.execution_id,
          source_id: sourceId,
          source_content_hash: source.sourceContentHash,
          registry_artifact_id: source.registryArtifactId,
          objects: fetched,
          generated_at: this.clock.now(),
        }),
      };
    }

    const downloadManifestRef =
      fetched.length === 0
        ? null
        : await this.persistManifest({
            manifest_version: 1,
            execution_id: request.execution_id,
            source_id: sourceId,
            source_content_hash: source.sourceContentHash,
            registry_artifact_id: source.registryArtifactId,
            objects: fetched,
            generated_at: this.clock.now(),
          });

    const evidence: PrefetchExecutionEvidence = {
      canonical_version: "pex-canonical-1",
      execution_id: request.execution_id,
      source_id: sourceId,
      source_content_hash: source.sourceContentHash,
      registry_artifact_id: source.registryArtifactId,
      download_manifest_ref: downloadManifestRef,
      outcomes,
    };
    return { kind: "PREFETCH_EVIDENCE", ref: await this.persistEvidence(evidenceStore, evidence) };
  }

  /**
   * A returned manifest reference is a replay boundary, not a calculated hint. Persist and
   * immediately resolve it so an injected store cannot claim success for absent or altered
   * bytes. P2-M1/P2-M2 exercise both failure modes.
   */
  private async persistManifest(manifest: DownloadManifest): Promise<ContentReference> {
    const expected = buildDownloadManifestRef(manifest);
    let persisted: ContentReference;
    let resolved: DownloadManifest | null;
    try {
      persisted = await this.manifestStore.persist(manifest);
      resolved = await this.manifestStore.resolve(persisted);
    } catch (error) {
      throw new GovernedDownloadError(
        `REJECT_MANIFEST_PERSISTENCE: ${error instanceof Error ? error.message : String(error)}`,
        "REJECT_MANIFEST_PERSISTENCE",
      );
    }

    if (
      persisted.id !== expected.id ||
      persisted.content_hash.algorithm !== expected.content_hash.algorithm ||
      persisted.content_hash.digest !== expected.content_hash.digest ||
      resolved === null
    ) {
      throw new GovernedDownloadError(
        "REJECT_MANIFEST_PERSISTENCE: the persisted manifest reference is not resolvable as the " +
          "manifest created by this governed execution.",
        "REJECT_MANIFEST_PERSISTENCE",
      );
    }

    const resolvedRef = buildDownloadManifestRef(resolved);
    if (
      resolvedRef.id !== expected.id ||
      resolvedRef.content_hash.digest !== expected.content_hash.digest
    ) {
      throw new GovernedDownloadError(
        "REJECT_MANIFEST_PERSISTENCE: resolved manifest bytes do not recompute to the returned " +
          "manifest reference.",
        "REJECT_MANIFEST_PERSISTENCE",
      );
    }

    return expected;
  }

  private async persistEvidence(
    store: PrefetchExecutionEvidenceStore,
    evidence: PrefetchExecutionEvidence,
  ): Promise<ContentReference> {
    const expected = buildPrefetchEvidenceRef(evidence);
    let persisted: ContentReference;
    let resolved: PrefetchExecutionEvidence | null;
    try {
      persisted = await store.persist(evidence);
      resolved = await store.resolve(persisted);
    } catch (error) {
      throw new GovernedDownloadError(
        `REJECT_PREFETCH_EVIDENCE: ${error instanceof Error ? error.message : String(error)}`,
        "REJECT_PREFETCH_EVIDENCE",
      );
    }
    if (
      persisted.id !== expected.id ||
      persisted.content_hash.digest !== expected.content_hash.digest ||
      resolved === null
    ) {
      throw new GovernedDownloadError(
        "REJECT_PREFETCH_EVIDENCE: the persisted prefetch evidence is not resolvable.",
        "REJECT_PREFETCH_EVIDENCE",
      );
    }
    const resolvedRef = buildPrefetchEvidenceRef(resolved);
    if (resolvedRef.content_hash.digest !== expected.content_hash.digest) {
      throw new GovernedDownloadError(
        "REJECT_PREFETCH_EVIDENCE: resolved prefetch evidence does not recompute to the returned reference.",
        "REJECT_PREFETCH_EVIDENCE",
      );
    }
    return expected;
  }

  private async maybeReplaceBinding(
    store: ValidatorBindingStore,
    source: NonNullable<ReturnType<VerifiedSourceRegistry["getSource"]>>,
    target: DownloadTarget,
    targetIdentity: string,
    response: StreamingHeaderResponse,
  ): Promise<void> {
    const authority = target.strongEtagAuthority ?? null;
    if (!isDeclaredStrongEtagAuthority(authority)) return;
    if (
      authority.sourceId !== source.sourceId ||
      authority.sourceContentHash !== source.sourceContentHash ||
      authority.registryArtifactId !== source.registryArtifactId ||
      authority.adapterId !== source.adapter ||
      authority.locatorIdentity !== target.url ||
      authority.targetIdentity !== targetIdentity
    ) {
      return;
    }
    if (response.finalUrl === undefined || response.finalUrl !== target.url) return;
    const etag = headerEtag(response.headers);
    if (etag === null || !isSingleStrongToken(etag)) return;
    await store.replace({
      sourceId: source.sourceId,
      sourceContentHash: source.sourceContentHash,
      registryArtifactId: source.registryArtifactId,
      locatorIdentity: target.url,
      targetIdentity,
      fileName: target.file_name,
      validatorClass: "STRONG_ETAG",
      validatorToken: etag,
      observedAt: this.clock.now(),
    });
  }

  /**
   * Fetch with the source's own retry policy.
   *
   * Retries are exhausted into a throw, never into a partial success. A manifest that silently
   * omitted an object would claim a complete harvest of an incomplete one.
   */
  private async fetchOne(
    source: NonNullable<ReturnType<VerifiedSourceRegistry["getSource"]>>,
    target: DownloadTarget,
    beforeOutbound: () => Promise<void>,
  ): Promise<{ readonly object: DownloadedObject; readonly response: StreamingHeaderResponse }> {
    if (isStreamingDownloadTransport(this.transport) && isStreamingQuarantineStorage(this.quarantine)) {
      return this.fetchOneStreaming(source, target, beforeOutbound, this.transport, this.quarantine);
    }
    return this.fetchOneBuffered(source, target, beforeOutbound);
  }

  /**
   * Stream the body into a temp quarantine object. A failure here is not retried through the
   * in-memory `get`/`put` path: that path would buffer the object this method exists to avoid.
   */
  private async fetchOneStreaming(
    source: NonNullable<ReturnType<VerifiedSourceRegistry["getSource"]>>,
    target: DownloadTarget,
    beforeOutbound: () => Promise<void>,
    transport: StreamingDownloadTransport,
    quarantine: StreamingQuarantineStorage,
  ): Promise<{ readonly object: DownloadedObject; readonly response: StreamingHeaderResponse }> {
    const { retry_policy: retry, max_object_size_bytes: maxBytes } = source.policy;
    const maxAttempts = Math.max(1, retry.max_attempts);
    let lastError: unknown;

    await beforeOutbound();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let body: StreamingDownloadBody | null = null;
      let session: StreamingQuarantinePutSession | null = null;
      try {
        body = await transport.open(target.url, {
          timeout_ms: STREAMING_HEADER_AND_IDLE_TIMEOUT_MS,
          max_bytes: maxBytes,
        });

        if (body.status < 200 || body.status >= 300) {
          throw new GovernedDownloadError(
            `REJECT_HTTP_STATUS: ${body.status} for '${target.url}'.`,
            "REJECT_HTTP_STATUS",
          );
        }

        if (maxBytes !== undefined && body.declaredByteLength !== null && body.declaredByteLength > maxBytes) {
          throw new GovernedDownloadError(
            `REJECT_OBJECT_SIZE: '${target.url}' declares ${body.declaredByteLength} bytes, ` +
              `over the ${maxBytes} byte limit for source '${source.sourceId}'.`,
            "REJECT_OBJECT_SIZE",
          );
        }

        if (body.declaredByteLength === 0) {
          throw new GovernedDownloadError(
            `REJECT_EMPTY_OBJECT: '${target.url}' returned no bytes.`,
            "REJECT_EMPTY_OBJECT",
          );
        }

        const observed = createHash("sha256");
        let total = 0;
        session = await quarantine.beginNetworkObservation({
          source_id: source.sourceId,
          source_url: target.url,
          file_name: target.file_name,
          max_bytes: maxBytes,
          ...(target.source_metadata
            ? {
                custom_metadata: {
                  registry_artifact_id: source.registryArtifactId,
                  source_metadata: { ...target.source_metadata },
                },
              }
            : { custom_metadata: { registry_artifact_id: source.registryArtifactId } }),
        });

        for (;;) {
          const chunk = await body.read();
          if (chunk === null) break;
          total += chunk.byteLength;
          if (maxBytes !== undefined && total > maxBytes) {
            throw new GovernedDownloadError(
              `REJECT_OBJECT_SIZE: '${target.url}' returned ${total} bytes, ` +
                `over the ${maxBytes} byte limit for source '${source.sourceId}'.`,
              "REJECT_OBJECT_SIZE",
            );
          }
          observed.update(chunk);
          await session.write(chunk);
        }

        if (total === 0) {
          throw new GovernedDownloadError(
            `REJECT_EMPTY_OBJECT: '${target.url}' returned no bytes.`,
            "REJECT_EMPTY_OBJECT",
          );
        }

        const expected = observed.digest("hex");
        const landed = await session.finalize({ byte_length: total, content_hash: expected });
        session = null;

        if (landed.hash !== expected || landed.byte_length !== total) {
          throw new GovernedDownloadError(
            `REJECT_CHECKSUM: quarantine stored ${landed.hash} (${landed.byte_length} bytes) but ` +
              `the streamed bytes hash to ${expected} (${total} bytes) for '${target.url}'.`,
            "REJECT_CHECKSUM",
          );
        }

        return {
          response: { headers: body.headers, finalUrl: body.finalUrl },
          object: {
            quarantine_id: landed.quarantine_id,
            source_id: source.sourceId,
            url: target.url,
            file_name: target.file_name,
            content_hash: landed.hash,
            byte_length: landed.byte_length,
            ...(target.source_metadata ? { source_metadata: { ...target.source_metadata } } : {}),
            deduplicated: landed.is_duplicate,
            attempts: attempt,
          },
        };
      } catch (error) {
        const cleanupFailure = await releaseStreamingAttempt(body, session);
        if (cleanupFailure) {
          throw new GovernedDownloadError(
            `REJECT_QUARANTINE_CLEANUP: temp cleanup failed after acquisition failure: ${cleanupFailure}`,
            "REJECT_QUARANTINE_CLEANUP",
          );
        }

        const governed = governedAcquisitionError(error);
        lastError = governed ?? error;
        if (governed && !isRetryable(governed)) {
          throw governed;
        }
        if (attempt < maxAttempts) {
          await this.sleep(backoffDelayMs(retry.backoff, attempt, source.policy));
        }
      }
    }

    throw new GovernedDownloadError(
      `REJECT_RETRIES_EXHAUSTED: '${target.url}' failed after ${maxAttempts} attempt(s): ` +
        `${lastError instanceof Error ? lastError.message : String(lastError)}`,
      "REJECT_RETRIES_EXHAUSTED",
    );
  }

  private async fetchOneBuffered(
    source: NonNullable<ReturnType<VerifiedSourceRegistry["getSource"]>>,
    target: DownloadTarget,
    beforeOutbound: () => Promise<void>,
  ): Promise<{ readonly object: DownloadedObject; readonly response: StreamingHeaderResponse }> {
    const { retry_policy: retry, max_object_size_bytes: maxBytes } = source.policy;
    const maxAttempts = Math.max(1, retry.max_attempts);
    let lastError: unknown;

    await beforeOutbound();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.transport.get(target.url, {
          timeout_ms: 30_000,
          max_bytes: maxBytes,
        });

        if (response.status < 200 || response.status >= 300) {
          throw new GovernedDownloadError(
            `REJECT_HTTP_STATUS: ${response.status} for '${target.url}'.`,
            "REJECT_HTTP_STATUS",
          );
        }

        // Size is re-checked here even though the transport was told the limit: the limit is
        // policy, and policy must be enforced by the governed path rather than trusted to an
        // injected collaborator.
        if (maxBytes !== undefined && response.bytes.byteLength > maxBytes) {
          throw new GovernedDownloadError(
            `REJECT_OBJECT_SIZE: '${target.url}' returned ${response.bytes.byteLength} bytes, ` +
              `over the ${maxBytes} byte limit for source '${source.sourceId}'.`,
            "REJECT_OBJECT_SIZE",
          );
        }

        if (response.bytes.byteLength === 0) {
          throw new GovernedDownloadError(
            `REJECT_EMPTY_OBJECT: '${target.url}' returned no bytes.`,
            "REJECT_EMPTY_OBJECT",
          );
        }

        const expected = sha256Hex(response.bytes);
        const landed = await this.quarantine.put(
          source.sourceId,
          target.url,
          target.file_name,
          response.bytes,
          {
            registry_artifact_id: source.registryArtifactId,
            // Adapter-observed metadata, carried verbatim. The executor never reads it and
            // knows nothing about its shape — which adapter produced it is deliberately
            // invisible here.
            //
            // NESTED, never spread at the top level: a flat merge would let adapter-controlled
            // keys overwrite `registry_artifact_id`, the binding that names the authority the
            // object was acquired under. Adapter data must not be able to forge provenance.
            ...(target.source_metadata
              ? { source_metadata: { ...target.source_metadata } }
              : {}),
          },
        );

        // The storage layer computes its own hash. If the two disagree, the bytes that were
        // stored are not the bytes that were verified, and nothing downstream can be trusted
        // to notice.
        if (landed.hash !== expected) {
          throw new GovernedDownloadError(
            `REJECT_CHECKSUM: quarantine stored ${landed.hash} but the fetched bytes hash to ` +
              `${expected} for '${target.url}'.`,
            "REJECT_CHECKSUM",
          );
        }

        return {
          response,
          object: {
            quarantine_id: landed.quarantine_id,
            source_id: source.sourceId,
            url: target.url,
            file_name: target.file_name,
            content_hash: landed.hash,
            byte_length: response.bytes.byteLength,
            ...(target.source_metadata ? { source_metadata: { ...target.source_metadata } } : {}),
            deduplicated: landed.is_duplicate,
            attempts: attempt,
          },
        };
      } catch (error) {
        lastError = error;

        // A rejection is a decision, not a transient fault. Retrying an out-of-policy response
        // would turn a governance refusal into a delay.
        if (error instanceof GovernedDownloadError && !isRetryable(error)) {
          throw error;
        }
        if (attempt < maxAttempts) {
          await this.sleep(backoffDelayMs(retry.backoff, attempt, source.policy));
        }
      }
    }

    throw new GovernedDownloadError(
      `REJECT_RETRIES_EXHAUSTED: '${target.url}' failed after ${maxAttempts} attempt(s): ` +
        `${lastError instanceof Error ? lastError.message : String(lastError)}`,
      "REJECT_RETRIES_EXHAUSTED",
    );
  }

  private async applyPoliteness(policy: {
    readonly rate_limit_requests_per_second: number;
    readonly politeness_delay_ms?: number;
  }): Promise<void> {
    const rateDelay =
      policy.rate_limit_requests_per_second > 0
        ? Math.ceil(1000 / policy.rate_limit_requests_per_second)
        : 0;
    const delay = Math.max(rateDelay, policy.politeness_delay_ms ?? 0);
    if (delay > 0) await this.sleep(delay);
  }

}

/**
 * A no-change claim has to be internally consistent, or it is just a flag an adapter can set.
 *
 * This is not verification — the executor never saw the listing. It is the minimum that makes
 * the claim falsifiable: something was consulted, and nothing came of it.
 */
function assertNoChangesEvidence(evidence: NoChangesEvidence, sourceId: string): void {
  if (evidence.pages_examined < 1) {
    throw new GovernedDownloadError(
      `REJECT_NO_CHANGES_EVIDENCE: '${sourceId}' claimed no changes without examining a single ` +
        "listing page. That is a resolver that did not look, not a source with nothing new.",
      "REJECT_NO_CHANGES_EVIDENCE",
    );
  }
  if (evidence.targets_produced !== 0) {
    throw new GovernedDownloadError(
      `REJECT_NO_CHANGES_EVIDENCE: '${sourceId}' claimed no changes while reporting ` +
        `${evidence.targets_produced} targets.`,
      "REJECT_NO_CHANGES_EVIDENCE",
    );
  }
  if (!evidence.listing_url) {
    throw new GovernedDownloadError(
      `REJECT_NO_CHANGES_EVIDENCE: '${sourceId}' claimed no changes without naming what it ` +
        "consulted, so the claim cannot be traced to a scope.",
      "REJECT_NO_CHANGES_EVIDENCE",
    );
  }
}

function headerEtag(headers: Readonly<Record<string, string>>): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "etag") return value;
  }
  return null;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function releaseStreamingAttempt(
  body: StreamingDownloadBody | null,
  session: StreamingQuarantinePutSession | null,
): Promise<string | null> {
  let failure: string | null = null;
  if (body) {
    try {
      await body.cancel();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  if (session) {
    try {
      await session.abort();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failure = failure === null ? message : `${failure}; ${message}`;
    }
  }
  return failure;
}

/**
 * Governance refusals stop the retry loop. A quarantine I/O error whose temp object was removed
 * stays retryable. Cleanup failure is not: retrying it could hide a leftover temp.
 */
function governedAcquisitionError(error: unknown): GovernedDownloadError | null {
  if (error instanceof GovernedDownloadError) return error;
  if (error instanceof StreamingQuarantineError) {
    if (error.reason_code === "REJECT_QUARANTINE_IO") return null;
    return new GovernedDownloadError(error.message, error.reason_code);
  }
  return null;
}

/** Only transport-level faults are worth another attempt. */
function isRetryable(error: GovernedDownloadError): boolean {
  return error.reason_code === "REJECT_HTTP_STATUS";
}

function backoffDelayMs(
  strategy: "EXPONENTIAL" | "FIXED",
  attempt: number,
  policy: { readonly politeness_delay_ms?: number },
): number {
  const base = policy.politeness_delay_ms ?? 250;
  return strategy === "EXPONENTIAL" ? base * 2 ** (attempt - 1) : base;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
