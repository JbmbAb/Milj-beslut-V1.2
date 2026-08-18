import {
  DiskQuarantineStorage,
  type QuarantineStorage,
  type VerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";

import {
  DownloadTargetResolverRegistry,
  SingleEndpointTargetResolver,
  type SourceAwareTargetResolver,
} from "./DownloadTargetResolvers";
import { FileDownloadManifestStore, type DownloadManifestStore } from "./DownloadManifestStore";
import { GovernedDownloadError, type DownloadTransport } from "./GovernedDownloadContracts";
import { GovernedDownloadExecutor } from "./GovernedDownloadExecutor";
import { HttpDownloadTransport } from "./HttpDownloadTransport";
import { PuhRattspraxisTargetResolver } from "./PuhRattspraxisResolver";
import {
  isUrlAllowedForVerifiedSource,
  loadVerifiedSourceRegistry,
  type VerifiedSourceDefinition,
  type VerifiedSourceRegistry,
} from "./SourceRegistry";

import type { ContentReference } from "../../mps-core/src/types";
import type { Clock, HarvestExecutor } from "./HarvestOrchestratorContracts";
import type { HarvestExecutionRequest } from "./HarvestOrchestratorTypes";
import { join } from "node:path";

/**
 * 🜃 P2-RUNTIME-01 — the production composition root for governed harvesting.
 *
 * Until now nothing in production assembled the governed download pipeline. The pieces all
 * existed — verified registry, adapters, transport, quarantine, executor — but the only place
 * they were ever wired together was inside tests, which meant the wiring itself was never a
 * reviewable artifact. This file is that artifact.
 *
 * ⚠️ CORE INVARIANT — SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM MUST NOT BE REQUIRED.
 *
 * A harvest host reads the registry. Reading is a verification, so this root asks for a
 * `VerificationKeyProvider` and never a `SigningKeyProvider`. The GOVERNOR private key is not
 * read, not defaulted to, and not reachable: `getSourceRegistrySigningKeyFromEnv` and
 * `approveSourceRegistryEntry` are not imported here, so no call path from this file arrives at
 * the minting side. That is a structural property of the import graph, not a rule someone has
 * to remember.
 *
 * What this root deliberately does NOT hold:
 *
 *   - no ImportGate, no CAS repository, no QuarantinePromoter — landing zone is quarantine, and
 *     promotion authority is absent by construction rather than by discipline;
 *   - no signing capability of any kind;
 *   - no `fetch` of its own. Networking exists only inside `HttpDownloadTransport`, which this
 *     root constructs and hands to the executor.
 *
 * Composition performs no network contact. It reads and verifies the registry from disk and
 * builds objects. The first request is issued when `execute()` is called — which is
 * P2-HARVEST-LIVE-01, not this unit.
 *
 * @see ./SourceRegistry.ts (loadVerifiedSourceRegistry — the governed read path)
 * @see ./GovernedDownloadExecutor.ts (the HarvestExecutor implementation)
 * @see ../tests/P2Runtime01CompositionRoot.test.ts (the proof)
 */

/**
 * Builds the resolver for one adapter, bound to a source-scoped transport.
 *
 * A factory rather than an instance because the transport is per-source (see
 * `transportForSource`): a resolver that captured a shared transport would make its listing
 * requests under the union of every approved source's scope.
 */
export type AdapterResolverFactory = (transport: DownloadTransport) => SourceAwareTargetResolver;

/**
 * Adapters this runtime is willing to execute.
 *
 * Keyed by the exact `adapter` string carried in the signed registry entry, so the registry —
 * not code — decides which adapter a source is harvested with.
 *
 * Only adapters that an APPROVED source actually names are registered. `WfsCapabilitiesTargetResolver`
 * exists and is tested, but no approved source declares a WFS adapter today; registering it
 * anyway would hand the runtime a capability no signed entry authorises. When such a source is
 * approved, adding the mapping is the deliberate act it should be. Until then an unknown adapter
 * fails closed through `DownloadTargetResolverRegistry`.
 */
export const PRODUCTION_ADAPTER_RESOLVERS: Readonly<Record<string, AdapterResolverFactory>> =
  Object.freeze({
    PUH_RATTSPRAXIS_V1: (transport: DownloadTransport) => new PuhRattspraxisTargetResolver(transport),
    SINGLE_ENDPOINT_V1: () => new SingleEndpointTargetResolver(),
  });

export interface HarvestRuntimeOptions {
  /** Defaults to `SOURCE_REGISTRY_ARTIFACT_PATH`, then to the repo-resolved authority file. */
  readonly registryPath?: string;
  /**
   * Verification capability only. Defaults to the key id + PUBLIC key from the environment.
   *
   * Typed as `VerificationKeyProvider` so a signer is accepted (signing extends verification)
   * but nothing here can call `sign`: the method is not on the type this root holds.
   */
  readonly signing?: VerificationKeyProvider;
  /** Defaults to `DiskQuarantineStorage` under `.quarantine`. Never CAS. */
  readonly quarantine?: QuarantineStorage;
  readonly quarantineRootPath?: string;
  /** P2-owned content-addressed store for replayable DownloadManifest bodies. */
  readonly downloadManifestStore?: DownloadManifestStore;
  /** Defaults below the quarantine root when the P2 store is not injected. */
  readonly downloadManifestRootPath?: string;
  readonly clock?: Clock;
  readonly adapters?: Readonly<Record<string, AdapterResolverFactory>>;
  readonly userAgent?: string;
  readonly maxRedirects?: number;
  /**
   * Injected so a caller can prove the composed runtime makes no request it was not asked to
   * make. Production leaves it unset and `HttpDownloadTransport` uses the platform `fetch`.
   */
  readonly fetchImpl?: typeof fetch;
}

export interface ComposedHarvestRuntime {
  /** Satisfies the existing `HarvestExecutor` port, so `HarvestOrchestrator` can drive it. */
  readonly executor: HarvestExecutor;
  /** The verified registry this runtime was composed against — approved sources only. */
  readonly registry: VerifiedSourceRegistry;
}

/** IMPORT-TIME-001 — timestamps enter the system here, never from inside a governed component. */
const systemClock: Clock = {
  now(): string {
    return new Date().toISOString();
  },
};

/**
 * Assembles the governed harvest runtime from the repo-resolved APPROVED authority.
 *
 * Offline: verifies the registry from disk and constructs the pipeline. No request is issued.
 */
export async function composeHarvestRuntime(
  options: HarvestRuntimeOptions = {},
): Promise<ComposedHarvestRuntime> {
  const registry = await loadVerifiedSourceRegistry({
    registryPath: options.registryPath,
    signing: options.signing,
  });

  const quarantineRootPath = options.quarantineRootPath ?? join(process.cwd(), ".quarantine");
  const quarantine = options.quarantine ?? new DiskQuarantineStorage(quarantineRootPath);
  const manifestStore =
    options.downloadManifestStore ??
    new FileDownloadManifestStore(
      options.downloadManifestRootPath ?? join(quarantineRootPath, "download-manifests"),
    );

  const executor = new GovernedHarvestRuntime(
    registry,
    options.adapters ?? PRODUCTION_ADAPTER_RESOLVERS,
    quarantine,
    manifestStore,
    options.clock ?? systemClock,
    (source) => transportForSource(source, options),
  );

  return { executor, registry };
}

/**
 * A transport that can only reach ONE source's approved domains.
 *
 * `HttpDownloadTransport` re-validates every redirect hop against this predicate. Sharing a
 * single transport across sources would mean the predicate had to accept the union of all
 * approved domains, and a redirect from one authority onto another authority's host would pass
 * the check while leaving the scope the source was actually approved for.
 */
function transportForSource(
  source: VerifiedSourceDefinition,
  options: HarvestRuntimeOptions,
): DownloadTransport {
  return new HttpDownloadTransport({
    isUrlAllowed: (url) => isUrlAllowedForVerifiedSource(source, url),
    maxRedirects: options.maxRedirects,
    userAgent: options.userAgent,
    fetchImpl: options.fetchImpl,
  });
}

/**
 * The composed runtime.
 *
 * Implements `HarvestExecutor` by resolving the source first, then building the source-scoped
 * pipeline for it. The per-request assembly is the point: transport scope is a property of the
 * source, so it cannot be fixed at composition time without either binding the root to a single
 * source or widening every transport to the union of all of them.
 */
class GovernedHarvestRuntime implements HarvestExecutor {
  constructor(
    private readonly registry: VerifiedSourceRegistry,
    private readonly adapters: Readonly<Record<string, AdapterResolverFactory>>,
    private readonly quarantine: QuarantineStorage,
    private readonly manifestStore: DownloadManifestStore,
    private readonly clock: Clock,
    private readonly transportFactory: (source: VerifiedSourceDefinition) => DownloadTransport,
  ) {}

  async execute(request: HarvestExecutionRequest): Promise<ContentReference> {
    const sourceId = request.dataset_ref.id;

    // Resolved here as well as inside the executor, because the transport cannot be scoped
    // without knowing the source. An unknown id must stop the run before any object is built.
    const source = this.registry.getSource(sourceId);
    if (!source) {
      throw new GovernedDownloadError(
        `REJECT_SOURCE: '${sourceId}' is not an approved source in the verified registry ` +
          `at '${this.registry.registryPath}'.`,
        "REJECT_SOURCE",
      );
    }

    const transport = this.transportFactory(source);

    // Every known adapter is instantiated against this source's transport, not just the one the
    // source names: `DownloadTargetResolverRegistry` reports which adapters were registered when
    // it refuses an unknown one, and that message is only honest if the set is the real one.
    const resolvers: Record<string, SourceAwareTargetResolver> = {};
    for (const [adapter, factory] of Object.entries(this.adapters)) {
      resolvers[adapter] = factory(transport);
    }

    const executor = new GovernedDownloadExecutor(
      this.registry,
      new DownloadTargetResolverRegistry(this.registry, resolvers),
      transport,
      this.quarantine,
      this.manifestStore,
      this.clock,
    );

    return executor.execute(request);
  }
}
