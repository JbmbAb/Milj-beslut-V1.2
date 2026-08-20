import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { DownloadTargetResolverRegistry } from "../src/DownloadTargetResolvers";
import { GovernedDownloadExecutor } from "../src/GovernedDownloadExecutor";
import type { DownloadTransport, ResolvedDownloadPlan } from "../src/GovernedDownloadContracts";
import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import {
  LANTMATERIET_STAC_BYGGNADER_COLLECTION_URL,
  LantmaterietStacByggnaderTargetResolver,
} from "../src/LantmaterietStacByggnaderResolver";
import { fixtureRegistry, fixtureSource } from "./fixtures/verifiedSourceRegistry";

const COLLECTION = LANTMATERIET_STAC_BYGGNADER_COLLECTION_URL;
const ASSET_ORIGIN = "https://dl1.lantmateriet.se/byggnadsverk";

function item(id: string, options: {
  updated?: string;
  href?: string;
  collection?: string;
  assets?: Record<string, { href?: string; type?: string }>;
} = {}) {
  return {
    type: "Feature",
    id,
    collection: options.collection ?? "byggnader",
    properties: { updated: options.updated ?? "2026-08-15T00:00:00Z" },
    assets: options.assets ?? {
      data: {
        type: "application/zip",
        href: options.href ?? `${ASSET_ORIGIN}/byggnad_kn${id}.zip`,
      },
    },
  };
}

function listing(features: readonly unknown[], next?: string) {
  return JSON.stringify({
    type: "FeatureCollection",
    features,
    links: next ? [{ rel: "next", href: next }] : [],
  });
}

function source() {
  return fixtureSource({
    sourceId: "lantmateriet-stac-byggnader",
    endpointUrl: COLLECTION,
    adapter: "LM_STAC_BYGGNADER_V1",
    allowedDomains: ["api.lantmateriet.se", "dl1.lantmateriet.se"],
    policy: {
      rate_limit_requests_per_second: 1,
      concurrency_limit: 1,
      politeness_delay_ms: 1_000,
      max_object_size_bytes: 50_000_000,
      retry_policy: { max_attempts: 3, backoff: "EXPONENTIAL" },
    },
  });
}

function listingTransport(pages: Record<string, string>): DownloadTransport & { readonly seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async get(url) {
      seen.push(url);
      const body = pages[url];
      return { status: body ? 200 : 404, bytes: new TextEncoder().encode(body ?? ""), headers: {} };
    },
  };
}

function targetsOf(plan: ResolvedDownloadPlan) {
  if (plan.kind !== "TARGETS") throw new Error(`expected TARGETS, got ${plan.kind}`);
  return plan.targets;
}

describe("P2-LM-STAC-BYGGNADER-ADAPTER-01", () => {
  it("enumerates the exact collection and carries item-to-asset provenance verbatim", async () => {
    const first = `${COLLECTION}?limit=100`;
    const next = `${COLLECTION}?limit=100&token=next%3Abyggnader%3A2482`;
    const transport = listingTransport({
      [first]: listing([item("2482")], next),
      [next]: listing([item("0128")]),
    });

    const targets = targetsOf(await new LantmaterietStacByggnaderTargetResolver(transport).resolve(source()));

    expect(transport.seen).toEqual([first, next]);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      url: `${ASSET_ORIGIN}/byggnad_kn2482.zip`,
      file_name: "byggnad_kn2482.zip",
      source_metadata: {
        lm_stac_collection: "byggnader",
        lm_stac_item_id: "2482",
        lm_stac_item_updated: "2026-08-15T00:00:00Z",
        lm_stac_asset_href: `${ASSET_ORIGIN}/byggnad_kn2482.zip`,
        lm_stac_asset_media_type: "application/zip",
      },
    });
  });

  it("rejects a wrong collection before listing it", async () => {
    const transport = listingTransport({});
    await expect(new LantmaterietStacByggnaderTargetResolver(transport).resolve(
      source().endpointUrl === COLLECTION
        ? { ...source(), endpointUrl: "https://api.lantmateriet.se/stac-vektor/v1/collections/mark/items" }
        : source(),
    )).rejects.toThrow(/REJECT_STAC_COLLECTION_SCOPE/);
    expect(transport.seen).toEqual([]);
  });

  it("rejects missing, ambiguous, and out-of-scope assets before an asset transport can receive them", async () => {
    const first = `${COLLECTION}?limit=100`;
    for (const malformed of [
      item("2482", { assets: {} }),
      item("2482", { assets: {
        data: { type: "application/zip", href: `${ASSET_ORIGIN}/byggnad_kn2482.zip` },
        mirror: { type: "application/zip", href: `${ASSET_ORIGIN}/byggnad_kn2482-copy.zip` },
      } }),
      item("2482", { href: "https://dl1.lantmateriet.se/hydrografi/vatten_kn2482.zip" }),
    ]) {
      await expect(new LantmaterietStacByggnaderTargetResolver(
        listingTransport({ [first]: listing([malformed]) }),
      ).resolve(source())).rejects.toThrow(/REJECT_STAC_ASSET|REJECT_AUTH_ASSET_SCOPE/);
    }
  });

  it("rejects conflicting duplicate items and pagination loops", async () => {
    const first = `${COLLECTION}?limit=100`;
    const next = `${COLLECTION}?limit=100&token=next%3Abyggnader%3A2482`;
    await expect(new LantmaterietStacByggnaderTargetResolver(listingTransport({
      [first]: listing([item("2482")], next),
      [next]: listing([item("2482", { updated: "2026-08-16T00:00:00Z" })]),
    })).resolve(source())).rejects.toThrow(/REJECT_STAC_CONFLICTING_ITEM/);

    await expect(new LantmaterietStacByggnaderTargetResolver(listingTransport({
      [first]: listing([item("2482")], first),
    })).resolve(source())).rejects.toThrow(/REJECT_STAC_PAGE_LOOP/);
  });

  it("persists the observed STAC item-to-asset relation in the manifest body but not its raw-byte identity", async () => {
    const verifiedSource = source();
    const registry = fixtureRegistry(verifiedSource);
    const first = `${COLLECTION}?limit=100`;
    const resolver = new LantmaterietStacByggnaderTargetResolver(
      listingTransport({ [first]: listing([item("2482")]) }),
    );
    const manifestStore = new InMemoryDownloadManifestStore();
    const bytes = new TextEncoder().encode("zip-content-v1");
    const executor = new GovernedDownloadExecutor(
      registry,
      new DownloadTargetResolverRegistry(registry, { LM_STAC_BYGGNADER_V1: resolver }),
      {
        async get() {
          return { status: 200, bytes, headers: {} };
        },
      },
      {
        async put(_sourceId, _url, _fileName, storedBytes) {
          return {
            quarantine_id: "q-building-2482",
            file_path: "",
            metadata_path: "",
            is_duplicate: false,
            hash: createHash("sha256").update(storedBytes).digest("hex"),
          };
        },
        async get() { return null; }, async getMetadata() { return null; },
        async updateStatus() {}, async list() { return []; },
      } as never,
      manifestStore,
      { now: () => "2026-08-20T00:00:00.000Z" },
    );

    const reference = await executor.execute({
      dataset_ref: { id: verifiedSource.sourceId, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
      execution_id: "lm-stac-adapter-proof",
      requested_at: "2026-08-20T00:00:00.000Z",
    });
    const manifest = await manifestStore.resolve(reference);

    expect(manifest?.objects[0].source_metadata?.lm_stac_item_id).toBe("2482");
    expect(manifest?.objects[0].source_metadata?.lm_stac_asset_href).toBe(
      `${ASSET_ORIGIN}/byggnad_kn2482.zip`,
    );
    expect(manifest?.objects[0].content_hash).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("records changed ZIP bytes as a new captured observation rather than overwriting the prior item", async () => {
    const verifiedSource = source();
    const registry = fixtureRegistry(verifiedSource);
    const first = `${COLLECTION}?limit=100`;
    const manifestStore = new InMemoryDownloadManifestStore();
    const run = async (bytes: Uint8Array) => {
      const executor = new GovernedDownloadExecutor(
        registry,
        new DownloadTargetResolverRegistry(registry, {
          LM_STAC_BYGGNADER_V1: new LantmaterietStacByggnaderTargetResolver(
            listingTransport({ [first]: listing([item("2482")]) }),
          ),
        }),
        { async get() { return { status: 200, bytes, headers: {} }; } },
        {
          async put(_sourceId, _url, _fileName, storedBytes) {
            const hash = createHash("sha256").update(storedBytes).digest("hex");
            return { quarantine_id: `q-${hash.slice(0, 12)}`, file_path: "", metadata_path: "", is_duplicate: false, hash };
          },
          async get() { return null; }, async getMetadata() { return null; },
          async updateStatus() {}, async list() { return []; },
        } as never,
        manifestStore,
        { now: () => "2026-08-20T00:00:00.000Z" },
      );
      const reference = await executor.execute({
        dataset_ref: { id: verifiedSource.sourceId, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
        execution_id: "lm-stac-byte-change",
        requested_at: "2026-08-20T00:00:00.000Z",
      });
      return { reference, manifest: await manifestStore.resolve(reference) };
    };

    const initial = await run(new TextEncoder().encode("zip-content-v1"));
    const changed = await run(new TextEncoder().encode("zip-content-v2"));

    expect(changed.reference.content_hash.digest).not.toBe(initial.reference.content_hash.digest);
    expect(changed.manifest?.objects[0].content_hash).not.toBe(initial.manifest?.objects[0].content_hash);
    expect(changed.manifest?.objects[0].source_metadata?.lm_stac_item_id).toBe("2482");
  });
});
