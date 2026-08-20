import { createHash } from "node:crypto";

import type { QuarantineStorage } from "@miljobeslut/mimers-brunn-core";

import { buildDownloadManifestRef } from "./DownloadManifestIdentity";
import type { DownloadManifestStore } from "./DownloadManifestStore";

import type { ContentReference } from "../../mps-core/src/types";
import type { HarvestExecutor, Clock } from "./HarvestOrchestratorContracts";
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
export class GovernedDownloadExecutor implements HarvestExecutor {
  constructor(
    private readonly registry: VerifiedSourceRegistry,
    private readonly resolver: DownloadTargetResolver,
    private readonly transport: DownloadTransport,
    private readonly quarantine: QuarantineStorage,
    private readonly manifestStore: DownloadManifestStore,
    private readonly clock: Clock,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  async execute(request: HarvestExecutionRequest): Promise<ContentReference> {
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

      return this.persistManifest({
        manifest_version: 1,
        execution_id: request.execution_id,
        source_id: sourceId,
        source_content_hash: source.sourceContentHash,
        registry_artifact_id: source.registryArtifactId,
        objects: [],
        no_changes: plan.evidence,
        generated_at: this.clock.now(),
      });
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

    const objects: DownloadedObject[] = [];
    for (const [index, target] of targets.entries()) {
      // Politeness applies BETWEEN requests, so it is skipped before the first one.
      if (index > 0) {
        await this.applyPoliteness(source.policy);
      }
      objects.push(await this.fetchOne(source, target));
    }

    return this.persistManifest({
      manifest_version: 1,
      execution_id: request.execution_id,
      source_id: sourceId,
      source_content_hash: source.sourceContentHash,
      registry_artifact_id: source.registryArtifactId,
      objects,
      generated_at: this.clock.now(),
    });
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

  /**
   * Fetch with the source's own retry policy.
   *
   * Retries are exhausted into a throw, never into a partial success. A manifest that silently
   * omitted an object would claim a complete harvest of an incomplete one.
   */
  private async fetchOne(
    source: NonNullable<ReturnType<VerifiedSourceRegistry["getSource"]>>,
    target: DownloadTarget,
  ): Promise<DownloadedObject> {
    const { retry_policy: retry, max_object_size_bytes: maxBytes } = source.policy;
    const maxAttempts = Math.max(1, retry.max_attempts);
    let lastError: unknown;

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
          quarantine_id: landed.quarantine_id,
          source_id: source.sourceId,
          url: target.url,
          file_name: target.file_name,
          content_hash: landed.hash,
          byte_length: response.bytes.byteLength,
          ...(target.source_metadata ? { source_metadata: { ...target.source_metadata } } : {}),
          deduplicated: landed.is_duplicate,
          attempts: attempt,
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

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
