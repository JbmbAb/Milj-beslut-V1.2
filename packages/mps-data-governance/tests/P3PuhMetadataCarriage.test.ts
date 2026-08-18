import { describe, it, expect } from "vitest";

import { GovernedDownloadExecutor } from "../src/GovernedDownloadExecutor";
import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import { PuhRattspraxisTargetResolver } from "../src/PuhRattspraxisResolver";
import { DownloadTargetResolverRegistry } from "../src/DownloadTargetResolvers";
import type {
  DownloadTransport,
  DownloadTarget,
  ResolvedDownloadPlan,
} from "../src/GovernedDownloadContracts";
import type { VerifiedSourceDefinition, VerifiedSourceRegistry } from "../src/SourceRegistry";

/**
 * ✅ P3-PUH-METADATA-CARRIAGE-01 — governed publication metadata survives acquisition.
 *
 *   Invariant under test:
 *     Metadata the adapter observed on the source's own response reaches quarantine VERBATIM,
 *     and is never normalized, parsed out of a file name, or interpreted into a downstream
 *     vocabulary on the way.
 *
 *   The defect this closes: `DownloadTarget` carried only `{ url, file_name }`. A PUH
 *   publication returns the fields that determine what a document IS — `typ`,
 *   `publiceringsform`, the publication id — and every one of them was dropped before
 *   `GovernedDownloadExecutor` saw it. 514 real MMÖD judgments therefore reached quarantine
 *   with no basis for classification, and cannot be classified now without re-harvesting.
 *
 *   ⚠️ Carriage only. `DOM_ELLER_BESLUT` stays `DOM_ELLER_BESLUT`. Translating it into an LU
 *   document type is a separate owner-frozen mapping — "dom eller beslut" is a disjunction and
 *   does not correspond one-to-one with any single LU class.
 */
describe("P3-PUH-METADATA-CARRIAGE-01", () => {
  const SOURCE_ID = "domstolsverket-puh-mmod";
  const ORIGIN = "https://rattspraxis.etjanst.domstol.se";
  const ENDPOINT = `${ORIGIN}/api/v1/publiceringar?domstolkod=MMOD`;

  const source: VerifiedSourceDefinition = {
    sourceId: SOURCE_ID,
    authority: { name: "Domstolsverket", type: "other" },
    endpointUrl: ENDPOINT,
    adapter: "PUH_RATTSPRAXIS_V1",
    frequency: "daily",
    allowedDomains: ["rattspraxis.etjanst.domstol.se"],
    artifactTypes: ["decision"],
    policy: {
      rate_limit_requests_per_second: 1000,
      concurrency_limit: 1,
      politeness_delay_ms: 0,
      max_object_size_bytes: 10_000_000,
      retry_policy: { max_attempts: 1, backoff: "FIXED" },
    },
    registryArtifactId: "reg-dv-puh-mmod-003",
    sourceContentHash: "a".repeat(64),
  };

  const registry: VerifiedSourceRegistry = {
    registryPath: "/test/registry.json",
    sources: [source],
    getSource: (id) => (id === SOURCE_ID ? source : null),
    isUrlAllowedForSource: () => true,
  };

  /** One publication exactly as PUH returns it. */
  const PUBLICATION = {
    id: "21f32e19-1479-4f09-89ed-f738b146d2c3",
    typ: "EJ_VAGLEDANDE",
    publiceringsform: "DOM_ELLER_BESLUT",
    avgorandedatum: "2026-07-15",
    domstol: { domstolKod: "MMOD", domstolNamn: "Mark- och miljööverdomstolen" },
    malNummerLista: ["F 8748-25"],
    bilagaLista: [{ fillagringId: "100/80/72/abc", filnamn: "F 8748-25 Dom.pdf" }],
  };

  function listingTransport(publications: unknown[]): DownloadTransport {
    return {
      async get(url: string) {
        const body = /\/publiceringar/.test(url) ? JSON.stringify(publications) : "%PDF-1.5 bytes";
        return { status: 200, bytes: new TextEncoder().encode(body), headers: {} };
      },
    };
  }

  async function resolveTargets(publications: unknown[]): Promise<readonly DownloadTarget[]> {
    const resolver = new PuhRattspraxisTargetResolver(listingTransport(publications), 100, 2);
    const plan: ResolvedDownloadPlan = await resolver.resolve(source);
    if (plan.kind !== "TARGETS") throw new Error(`expected TARGETS, got ${plan.kind}`);
    return plan.targets;
  }

  // --------------------------------------------------------- carriage, verbatim

  it("carries the publication fields PUH returned, unchanged", async () => {
    const [target] = await resolveTargets([PUBLICATION]);
    const meta = target.source_metadata!;

    expect(meta.puh_publication_id).toBe("21f32e19-1479-4f09-89ed-f738b146d2c3");
    expect(meta.puh_typ).toBe("EJ_VAGLEDANDE");
    expect(meta.puh_domstolskod).toBe("MMOD");
    expect(meta.puh_avgorandedatum).toBe("2026-07-15");
    expect(meta.puh_fillagring_id).toBe("100/80/72/abc");

    expect(
      meta.puh_publiceringsform,
      "DOM_ELLER_BESLUT must survive as itself. Normalizing it here would bury a classification " +
        "decision inside a transport step.",
    ).toBe("DOM_ELLER_BESLUT");
  });

  it("interprets nothing — no LU vocabulary appears in carried metadata", async () => {
    const [target] = await resolveTargets([PUBLICATION]);
    const values = Object.values(target.source_metadata!).map((v) => v.toLowerCase());

    for (const luClass of ["decision", "injunction", "notification", "inspection"]) {
      expect(
        values.includes(luClass),
        `carriage must not emit the LU class '${luClass}' — that is the mapping unit's job`,
      ).toBe(false);
    }
  });

  it("omits absent fields rather than defaulting them", async () => {
    const sparse = { bilagaLista: [{ fillagringId: "x/y/z" }] };
    const [target] = await resolveTargets([sparse]);
    const meta = target.source_metadata!;

    for (const key of ["puh_typ", "puh_publiceringsform", "puh_publication_id", "puh_avgorandedatum"]) {
      expect(
        Object.prototype.hasOwnProperty.call(meta, key),
        `${key} must be ABSENT — an empty string is indistinguishable from a real value`,
      ).toBe(false);
    }
    expect(meta.puh_fillagring_id).toBe("x/y/z");
  });

  // --------------------------------------------------------- reaches quarantine

  it("reaches quarantine nested under source_metadata", async () => {
    const puts: any[] = [];
    const quarantine = {
      async put(sourceId: string, url: string, fileName: string, bytes: Uint8Array, meta?: any) {
        puts.push(meta);
        return { quarantine_id: `q${puts.length}`, file_path: "", metadata_path: "", is_duplicate: false,
                 hash: require("node:crypto").createHash("sha256").update(bytes).digest("hex") };
      },
      get: async () => null, getMetadata: async () => null,
      updateStatus: async () => undefined, list: async () => [],
    };

    const transport = listingTransport([PUBLICATION]);
    // Wired exactly as the composition root does: the executor speaks DownloadTargetResolver,
    // and DownloadTargetResolverRegistry adapts the source-aware PUH resolver to it.
    const executor = new GovernedDownloadExecutor(
      registry,
      new DownloadTargetResolverRegistry(registry, {
        PUH_RATTSPRAXIS_V1: new PuhRattspraxisTargetResolver(transport, 100, 2),
      }),
      transport,
      quarantine as never,
      new InMemoryDownloadManifestStore(),
      { now: () => "2026-08-15T00:00:00.000Z" },
    );

    await executor.execute({
      dataset_ref: { id: SOURCE_ID, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
      execution_id: "exec-carriage",
      requested_at: "2026-08-15T00:00:00.000Z",
    });

    expect(puts).toHaveLength(1);
    expect(puts[0].registry_artifact_id).toBe("reg-dv-puh-mmod-003");
    expect(puts[0].source_metadata.puh_publiceringsform).toBe("DOM_ELLER_BESLUT");
    expect(puts[0].source_metadata.puh_typ).toBe("EJ_VAGLEDANDE");
  });

  // ------------------------------------- adapter metadata cannot forge governance

  it("adapter metadata CANNOT overwrite the governance binding", async () => {
    const puts: any[] = [];
    const quarantine = {
      async put(_s: string, _u: string, _f: string, bytes: Uint8Array, meta?: any) {
        puts.push(meta);
        return { quarantine_id: "q1", file_path: "", metadata_path: "", is_duplicate: false,
                 hash: require("node:crypto").createHash("sha256").update(bytes).digest("hex") };
      },
      get: async () => null, getMetadata: async () => null,
      updateStatus: async () => undefined, list: async () => [],
    };

    // A hostile adapter attempting to claim a different acquiring authority.
    const hostileResolver = {
      async resolve(): Promise<ResolvedDownloadPlan> {
        return {
          kind: "TARGETS",
          targets: [{
            url: `${ORIGIN}/api/v1/bilagor/x`,
            file_name: "x.pdf",
            source_metadata: { registry_artifact_id: "reg-forged-999", puh_typ: "EJ_VAGLEDANDE" },
          }],
        };
      },
    };

    const executor = new GovernedDownloadExecutor(
      registry, hostileResolver, listingTransport([]), quarantine as never,
      new InMemoryDownloadManifestStore(),
      { now: () => "2026-08-15T00:00:00.000Z" },
    );

    await executor.execute({
      dataset_ref: { id: SOURCE_ID, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
      execution_id: "exec-hostile",
      requested_at: "2026-08-15T00:00:00.000Z",
    });

    expect(
      puts[0].registry_artifact_id,
      "Adapter data is NESTED, never spread at the top level. A flat merge would let an adapter " +
        "overwrite the binding that names the authority the object was acquired under.",
    ).toBe("reg-dv-puh-mmod-003");
    expect(puts[0].source_metadata.registry_artifact_id).toBe("reg-forged-999");
  });

  // ------------------------------------------------- manifest identity is unchanged

  it("does NOT change manifest identity", async () => {
    const mkQuarantine = () => ({
      async put(_s: string, _u: string, _f: string, bytes: Uint8Array) {
        return { quarantine_id: "fixed-q-id", file_path: "", metadata_path: "", is_duplicate: false,
                 hash: require("node:crypto").createHash("sha256").update(bytes).digest("hex") };
      },
      get: async () => null, getMetadata: async () => null,
      updateStatus: async () => undefined, list: async () => [],
    });

    const run = async (withMetadata: boolean) => {
      const resolver = {
        async resolve(): Promise<ResolvedDownloadPlan> {
          return {
            kind: "TARGETS",
            targets: [{
              url: `${ORIGIN}/api/v1/bilagor/x`,
              file_name: "x.pdf",
              ...(withMetadata ? { source_metadata: { puh_typ: "EJ_VAGLEDANDE" } } : {}),
            }],
          };
        },
      };
      const executor = new GovernedDownloadExecutor(
        registry, resolver, listingTransport([]), mkQuarantine() as never,
        new InMemoryDownloadManifestStore(),
        { now: () => "2026-08-15T00:00:00.000Z" },
      );
      return executor.execute({
        dataset_ref: { id: SOURCE_ID, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
        execution_id: "exec-identity",
        requested_at: "2026-08-15T00:00:00.000Z",
      });
    };

    const without = await run(false);
    const with_ = await run(true);

    expect(
      with_.content_hash.digest,
      "Manifest identity hashes DownloadedObject, which source_metadata never reaches. If this " +
        "differed, adding carriage would have invalidated every manifest already produced.",
    ).toBe(without.content_hash.digest);
  });
});
