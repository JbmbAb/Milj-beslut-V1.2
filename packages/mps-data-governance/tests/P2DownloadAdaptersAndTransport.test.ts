import { describe, it, expect } from "vitest";

import { HttpDownloadTransport } from "../src/HttpDownloadTransport";
import {
  DownloadTargetResolverRegistry,
  SingleEndpointTargetResolver,
  WfsCapabilitiesTargetResolver,
  parseWfsTypeNames,
  parseWfsVersion,
} from "../src/DownloadTargetResolvers";
import {
  GovernedDownloadError,
  type DownloadTarget,
  type DownloadTransport,
  type ResolvedDownloadPlan,
} from "../src/GovernedDownloadContracts";
import { isUrlAllowedForVerifiedSource } from "../src/SourceRegistry";
import { fixtureRegistry, fixtureSource } from "./fixtures/verifiedSourceRegistry";

/**
 * ✅ P2 — DOWNLOAD ADAPTERS AND TRANSPORT PROOF.
 *
 *   Proven here, below the authority seam:
 *     - the adapter a source is APPROVED for selects the resolver, fail-closed on unknown
 *     - the transport cannot leave the approved scope, including via redirects
 *     - the size limit is enforced DURING transfer, not after
 *
 *   NOT proven here, and deliberately so: the production composition root. The real
 *   registry artifact does not yet conform to the frozen contract, and re-issuing it is a
 *   GOVERNOR action. These tests therefore run against an explicit fixture registry —
 *   see tests/fixtures/verifiedSourceRegistry.ts for why that is not a shortcut.
 */
/** P2-EMPTY-PLAN-01: resolvers return a plan now. Tests that expect work unwrap it here. */
function targetsOf(plan: ResolvedDownloadPlan): readonly DownloadTarget[] {
  if (plan.kind !== "TARGETS") {
    throw new Error(`expected a TARGETS plan, got ${plan.kind}`);
  }
  return plan.targets;
}

describe("P2 — download adapters and transport", () => {

  const CAPABILITIES = `<?xml version="1.0"?>
<WFS_Capabilities version="2.0.0" xmlns:wfs="http://www.opengis.net/wfs/2.0">
  <wfs:FeatureTypeList>
    <wfs:FeatureType><wfs:Name>sgu:jordarter_25_100</wfs:Name></wfs:FeatureType>
    <wfs:FeatureType><wfs:Name>sgu:jorddjup</wfs:Name></wfs:FeatureType>
  </wfs:FeatureTypeList>
</WFS_Capabilities>`;

  function transportReturning(
    handler: (url: string) => { status: number; body?: string; headers?: Record<string, string> },
  ): DownloadTransport & { seen: string[] } {
    const seen: string[] = [];
    return {
      seen,
      async get(url) {
        seen.push(url);
        const r = handler(url);
        return {
          status: r.status,
          bytes: new TextEncoder().encode(r.body ?? ""),
          headers: r.headers ?? {},
        };
      },
    };
  }

  // ----------------------------------------------------------- ADAPTER SELECTION

  it("the adapter the source is APPROVED for selects the resolver", async () => {
    const source = fixtureSource({ adapter: "single_v1" });
    const registry = new DownloadTargetResolverRegistry(fixtureRegistry(source), {
      single_v1: new SingleEndpointTargetResolver(),
    });

    const targets = targetsOf(await registry.resolve({
      source_id: source.sourceId,
      execution_id: "exec-1",
    }));

    expect(targets).toHaveLength(1);
    expect(targets[0].url).toBe(source.endpointUrl);
  });

  it("an unknown adapter is REJECTED — no silent fallback to 'just fetch the endpoint'", async () => {
    const source = fixtureSource({ adapter: "unregistered_v9" });
    const registry = new DownloadTargetResolverRegistry(fixtureRegistry(source), {
      single_v1: new SingleEndpointTargetResolver(),
    });

    await expect(
      registry.resolve({ source_id: source.sourceId, execution_id: "exec-1" }),
      "A fallback would let a source be harvested by a different adapter than the one it was " +
        "approved with, and the manifest would not show it.",
    ).rejects.toThrow(/REJECT_ADAPTER/);
  });

  it("an unapproved source is REJECTED before any adapter runs", async () => {
    const registry = new DownloadTargetResolverRegistry(fixtureRegistry(), {
      wfs_v1: new SingleEndpointTargetResolver(),
    });

    await expect(
      registry.resolve({ source_id: "not-registered", execution_id: "exec-1" }),
    ).rejects.toThrow(/REJECT_SOURCE/);
  });

  it("a source without an endpoint is REJECTED", async () => {
    const source = fixtureSource({ adapter: "single_v1", endpointUrl: undefined });
    const registry = new DownloadTargetResolverRegistry(fixtureRegistry(source), {
      single_v1: new SingleEndpointTargetResolver(),
    });

    await expect(
      registry.resolve({ source_id: source.sourceId, execution_id: "exec-1" }),
    ).rejects.toThrow(/REJECT_SOURCE_ENDPOINT/);
  });

  // ------------------------------------------------------------------- WFS ADAPTER

  it("WFS emits one GetFeature target per advertised feature type", async () => {
    const transport = transportReturning(() => ({ status: 200, body: CAPABILITIES }));
    const targets = targetsOf(await new WfsCapabilitiesTargetResolver(transport).resolve(fixtureSource()));

    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.file_name)).toEqual([
      "sgu_jordarter_25_100.gml",
      "sgu_jorddjup.gml",
    ]);

    const first = new URL(targets[0].url);
    expect(first.searchParams.get("request")).toBe("GetFeature");
    expect(
      first.searchParams.get("typeNames"),
      "WFS 2.0 renamed typeName to typeNames. Using the wrong one returns an exception " +
        "document with HTTP 200, which would be quarantined as if it were data.",
    ).toBe("sgu:jordarter_25_100");
  });

  it("WFS 1.1 gets the 1.1 parameter name", async () => {
    const v11 = CAPABILITIES.replace('version="2.0.0"', 'version="1.1.0"');
    const transport = transportReturning(() => ({ status: 200, body: v11 }));
    const targets = targetsOf(await new WfsCapabilitiesTargetResolver(transport).resolve(fixtureSource()));

    const first = new URL(targets[0].url);
    expect(first.searchParams.get("typeName")).toBe("sgu:jordarter_25_100");
    expect(first.searchParams.has("typeNames")).toBe(false);
  });

  it("stale OGC parameters on the registry URL are replaced, not duplicated", async () => {
    const transport = transportReturning(() => ({ status: 200, body: CAPABILITIES }));
    const source = fixtureSource({
      endpointUrl: "https://resource.sgu.se/service/wfs/130/jordarter?REQUEST=GetCapabilities&SERVICE=WFS",
    });

    const targets = targetsOf(await new WfsCapabilitiesTargetResolver(transport).resolve(source));
    const params = new URL(targets[0].url).searchParams;

    expect(
      params.getAll("REQUEST").concat(params.getAll("request")),
      "OGC parameter names are case-insensitive, so a stale REQUEST=GetCapabilities would " +
        "silently win over the request we set.",
    ).toEqual(["GetFeature"]);
  });

  it("a capabilities document advertising nothing is REJECTED", async () => {
    const transport = transportReturning(() => ({
      status: 200,
      body: '<?xml version="1.0"?><WFS_Capabilities version="2.0.0"/>',
    }));

    await expect(
      new WfsCapabilitiesTargetResolver(transport).resolve(fixtureSource()),
      "Zero targets is indistinguishable from a source that is simply empty.",
    ).rejects.toThrow(/REJECT_CAPABILITIES/);
  });

  it("the capabilities request goes through the governed transport under source policy", async () => {
    const transport = transportReturning(() => ({ status: 200, body: CAPABILITIES }));
    await new WfsCapabilitiesTargetResolver(transport).resolve(fixtureSource());

    expect(transport.seen).toHaveLength(1);
    expect(new URL(transport.seen[0]).searchParams.get("request")).toBe("GetCapabilities");
  });

  it("parsers are namespace-agnostic and de-duplicate", () => {
    expect(parseWfsTypeNames(CAPABILITIES)).toEqual([
      "sgu:jordarter_25_100",
      "sgu:jorddjup",
    ]);
    expect(parseWfsTypeNames(CAPABILITIES + CAPABILITIES)).toHaveLength(2);
    expect(parseWfsVersion(CAPABILITIES)).toBe("2.0.0");
  });

  // ---------------------------------------------------------------- TRANSPORT

  function httpTransport(
    routes: Record<string, { status: number; body?: string; headers?: Record<string, string> }>,
    source = fixtureSource(),
  ) {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      const key = url.toString();
      calls.push(key);
      const route = routes[key] ?? { status: 404 };
      return new Response(route.body ?? "", {
        status: route.status,
        headers: route.headers ?? {},
      });
    }) as unknown as typeof fetch;

    return {
      calls,
      transport: new HttpDownloadTransport({
        isUrlAllowed: (u) => isUrlAllowedForVerifiedSource(source, u),
        fetchImpl,
      }),
    };
  }

  it("fetches an in-scope URL and returns the bytes", async () => {
    const url = "https://resource.sgu.se/data.gml";
    const { transport } = httpTransport({ [url]: { status: 200, body: "<gml/>" } });

    const response = await transport.get(url, { timeout_ms: 1000 });

    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.bytes)).toBe("<gml/>");
  });

  it("🔒 a redirect OFF the approved domain is REJECTED", async () => {
    const start = "https://resource.sgu.se/data.gml";
    const evil = "https://evil.example.com/data.gml";
    const { transport, calls } = httpTransport({
      [start]: { status: 302, headers: { location: evil } },
      [evil]: { status: 200, body: "pwned" },
    });

    await expect(
      transport.get(start, { timeout_ms: 1000 }),
      "The executor validates URLs before any request, but a redirect happens after that check. " +
        "The transport is the only place it can be enforced.",
    ).rejects.toThrow(/REJECT_REDIRECT_SCOPE/);

    expect(calls, "the off-scope host must never be contacted").toEqual([start]);
  });

  it("a redirect within the approved domain is followed", async () => {
    const start = "https://resource.sgu.se/a";
    const next = "https://resource.sgu.se/b";
    const { transport } = httpTransport({
      [start]: { status: 302, headers: { location: "/b" } },
      [next]: { status: 200, body: "ok" },
    });

    const response = await transport.get(start, { timeout_ms: 1000 });
    expect(new TextDecoder().decode(response.bytes)).toBe("ok");
  });

  it("a redirect loop fails fast rather than hanging", async () => {
    const a = "https://resource.sgu.se/a";
    const b = "https://resource.sgu.se/b";
    const { transport } = httpTransport({
      [a]: { status: 302, headers: { location: b } },
      [b]: { status: 302, headers: { location: a } },
    });

    await expect(transport.get(a, { timeout_ms: 1000 })).rejects.toThrow(/REJECT_REDIRECT_LIMIT/);
  });

  it("a redirect without Location is REJECTED", async () => {
    const url = "https://resource.sgu.se/a";
    const { transport } = httpTransport({ [url]: { status: 302 } });

    await expect(transport.get(url, { timeout_ms: 1000 })).rejects.toThrow(/REJECT_REDIRECT/);
  });

  it("an oversized declared content-length is REJECTED before the body is read", async () => {
    const url = "https://resource.sgu.se/big.gml";
    const { transport } = httpTransport({
      [url]: { status: 200, body: "x".repeat(50), headers: { "content-length": "999999" } },
    });

    await expect(
      transport.get(url, { timeout_ms: 1000, max_bytes: 1000 }),
    ).rejects.toThrow(/REJECT_OBJECT_SIZE/);
  });

  it("the size limit is enforced DURING transfer, not after buffering", async () => {
    const url = "https://resource.sgu.se/lying.gml";
    // No content-length: the only way to catch this is while streaming.
    const { transport } = httpTransport({ [url]: { status: 200, body: "x".repeat(5000) } });

    await expect(
      transport.get(url, { timeout_ms: 1000, max_bytes: 100 }),
      "Trusting content-length would trust the server; measuring after buffering would mean " +
        "the bytes are already in memory, which is not a limit.",
    ).rejects.toThrow(/REJECT_OBJECT_SIZE/);
  });

  it("a transport fault is classified as retryable, a scope refusal is not", async () => {
    const url = "https://resource.sgu.se/x";
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const transport = new HttpDownloadTransport({
      isUrlAllowed: () => true,
      fetchImpl,
    });

    await transport.get(url, { timeout_ms: 50 }).catch((e: GovernedDownloadError) => {
      expect(
        e.reason_code,
        "A reset is transient and should be retried; a governance refusal must not be.",
      ).toBe("REJECT_HTTP_STATUS");
    });

    const scoped = new HttpDownloadTransport({ isUrlAllowed: () => false, fetchImpl });
    await scoped.get(url, { timeout_ms: 50 }).catch((e: GovernedDownloadError) => {
      expect(e.reason_code).toBe("REJECT_URL_SCOPE");
    });
  });
});
