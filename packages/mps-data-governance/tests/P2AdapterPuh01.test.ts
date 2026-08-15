import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  PuhRattspraxisTargetResolver,
  parsePublications,
  withPaging,
  PUH_PAGE_SIZE,
} from "../src/PuhRattspraxisResolver";
import { DownloadTargetResolverRegistry } from "../src/DownloadTargetResolvers";
import type {
  DownloadTarget,
  DownloadTransport,
  ResolvedDownloadPlan,
} from "../src/GovernedDownloadContracts";
import { isUrlAllowedForVerifiedSource, type VerifiedSourceDefinition } from "../src/SourceRegistry";

/**
 * ✅ P2-ADAPTER-PUH-01 — PUH_RATTSPRAXIS_V1 ADAPTER PROOF.
 *
 *   Invariant under test:
 *     The adapter enumerates only within the approved scope, reaches the network only through
 *     the governed transport, and fails rather than truncating.
 *
 *   First adapter built against a real signed source. The source definition used here is read
 *   from the INSTALLED production registry where available, so the test is measured against the
 *   authority that actually exists rather than a fixture that resembles it.
 */
/** P2-EMPTY-PLAN-01: resolvers return a plan now. Tests that expect work unwrap it here. */
function targetsOf(plan: ResolvedDownloadPlan): readonly DownloadTarget[] {
  if (plan.kind !== "TARGETS") {
    throw new Error(`expected a TARGETS plan, got ${plan.kind}`);
  }
  return plan.targets;
}

describe("P2-ADAPTER-PUH-01 — PUH rättspraxis adapter", () => {

  const REPO_ROOT = resolve(__dirname, "../../..");
  const ENDPOINT =
    "https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar" +
    "?domstolkod=MMOD&publiceringstyper=dom_eller_beslut&publicerad_fran_och_med=2025-03-04";

  /** The installed authority if present; otherwise a definition of the same shape. */
  function source(): VerifiedSourceDefinition {
    let endpointUrl = ENDPOINT;
    try {
      const installed = JSON.parse(
        readFileSync(join(REPO_ROOT, "source-registry", "national-registry.json"), "utf8"),
      ) as { source_id?: string; channel?: { endpoint_url?: string } }[];
      const entry = installed.find((e) => e.source_id === "domstolsverket-puh-mmod");
      if (entry?.channel?.endpoint_url) endpointUrl = entry.channel.endpoint_url;
    } catch {
      // Not installed in this checkout — the constant above is the same scope.
    }

    return {
      sourceId: "domstolsverket-puh-mmod",
      authority: { name: "Domstolsverket", type: "other" },
      endpointUrl,
      adapter: "PUH_RATTSPRAXIS_V1",
      frequency: "daily",
      allowedDomains: ["rattspraxis.etjanst.domstol.se"],
      artifactTypes: ["decision"],
      policy: {
        rate_limit_requests_per_second: 1,
        concurrency_limit: 1,
        politeness_delay_ms: 1000,
        max_object_size_bytes: 52_428_800,
        retry_policy: { max_attempts: 3, backoff: "EXPONENTIAL" },
      },
      registryArtifactId: "reg-dv-puh-mmod-001",
      sourceContentHash: "a".repeat(64),
    };
  }

  function publication(id: string, attachments: { id: string; name: string }[]) {
    return {
      id,
      avgorandedatum: "2026-07-17",
      domstol: { domstolKod: "MMOD", domstolNamn: "Mark- och miljööverdomstolen" },
      bilagaLista: attachments.map((a) => ({ fillagringId: a.id, filnamn: a.name })),
    };
  }

  function transportOf(pages: unknown[][]): DownloadTransport & { seen: string[] } {
    const seen: string[] = [];
    return {
      seen,
      async get(url) {
        seen.push(url);
        const page = Number(new URL(url).searchParams.get("page") ?? 0);
        return {
          status: 200,
          bytes: new TextEncoder().encode(JSON.stringify(pages[page] ?? [])),
          headers: {},
        };
      },
    };
  }

  // ------------------------------------------------------------------- ENUMERATION

  it("turns publications into attachment targets on the source's own origin", async () => {
    const transport = transportOf([
      [publication("p1", [{ id: "700/a6/2b/abc", name: "1889-24.pdf" }])],
    ]);

    const targets = targetsOf(await new PuhRattspraxisTargetResolver(transport).resolve(source()));

    expect(targets).toHaveLength(1);
    expect(targets[0].url).toBe(
      "https://rattspraxis.etjanst.domstol.se/api/v1/bilagor/700%2Fa6%2F2b%2Fabc",
    );
    expect(targets[0].file_name).toBe("MMOD_2026-07-17_1889-24.pdf");
  });

  it("every emitted target is inside the approved domain", async () => {
    const transport = transportOf([
      [publication("p1", [{ id: "x/1", name: "a.pdf" }, { id: "x/2", name: "b.pdf" }])],
    ]);

    const src = source();
    const targets = targetsOf(await new PuhRattspraxisTargetResolver(transport).resolve(src));

    for (const target of targets) {
      expect(
        isUrlAllowedForVerifiedSource(src, target.url),
        "The listing carries no attachment URLs, so they are constructed. Constructing them " +
          "from anything but the source's own origin would reach outside the approved host.",
      ).toBe(true);
    }
  });

  it("preserves the signed scope while paging", async () => {
    const transport = transportOf([[publication("p1", [{ id: "a", name: "a.pdf" }])]]);
    targetsOf(await new PuhRattspraxisTargetResolver(transport).resolve(source()));

    const params = new URL(transport.seen[0]).searchParams;
    expect(params.get("domstolkod")).toBe("MMOD");
    expect(params.get("publiceringsformer")).toBe("DOM_ELLER_BESLUT");
    expect(params.has("publiceringstyper")).toBe(false);
    expect(params.get("publicerad_fran_och_med")).toBe("2025-03-04");
    expect(params.get("page")).toBe("0");
    expect(params.get("pagesize")).toBe(String(PUH_PAGE_SIZE));
  });

  it("walks pages until a short page ends the listing", async () => {
    const full = Array.from({ length: 3 }, (_, i) =>
      publication(`p${i}`, [{ id: `id-${i}`, name: `${i}.pdf` }]),
    );
    const transport = transportOf([
      full,
      [publication("p3", [{ id: "id-3", name: "3.pdf" }])],
    ]);

    const targets = targetsOf(await new PuhRattspraxisTargetResolver(transport, 3, 10).resolve(source()));

    expect(transport.seen).toHaveLength(2);
    expect(targets).toHaveLength(4);
  });

  it("the same document attached twice is fetched once", async () => {
    // A decision and its referat can reference the same file. Two targets would mean two
    // quarantine entries for one object.
    const transport = transportOf([
      [
        publication("p1", [{ id: "shared", name: "dom.pdf" }]),
        publication("p2", [{ id: "shared", name: "dom.pdf" }]),
      ],
    ]);

    const targets = targetsOf(await new PuhRattspraxisTargetResolver(transport).resolve(source()));
    expect(targets).toHaveLength(1);
  });

  it("publications without attachments are a verified no-change day, not an empty plan", async () => {
    // Changed by P2-EMPTY-PLAN-01. This previously asserted an empty target array; that is now
    // NO_CHANGES, because a notis often carries no attachment and an ordinary day must not fail.
    const transport = transportOf([[{ id: "p1", bilagaLista: [] }]]);
    const plan = await new PuhRattspraxisTargetResolver(transport).resolve(source());

    expect(plan.kind).toBe("NO_CHANGES");
    if (plan.kind === "NO_CHANGES") {
      expect(plan.evidence.items_observed).toBe(1);
      expect(plan.evidence.targets_produced).toBe(0);
    }
  });

  // ------------------------------------------------------------------- FAIL CLOSED

  it("fails rather than truncating when pages never end", async () => {
    const full = Array.from({ length: 2 }, (_, i) =>
      publication(`p${i}`, [{ id: `${i}`, name: `${i}.pdf` }]),
    );
    const endless: DownloadTransport = {
      async get(url) {
        const page = Number(new URL(url).searchParams.get("page") ?? 0);
        const items = full.map((p) => ({ ...p, id: `${page}-${p.id}` }));
        // Unique ids per page, so dedup cannot mask the runaway.
        items.forEach((p, i) => {
          (p as { bilagaLista: { fillagringId: string; filnamn: string }[] }).bilagaLista = [
            { fillagringId: `${page}-${i}`, filnamn: `${page}-${i}.pdf` },
          ];
        });
        return { status: 200, bytes: new TextEncoder().encode(JSON.stringify(items)), headers: {} };
      },
    };

    await expect(
      new PuhRattspraxisTargetResolver(endless, 2, 3).resolve(source()),
      "A silently short harvest looks like a complete one. The bound must fail, not stop.",
    ).rejects.toThrow(/REJECT_PAGE_LIMIT/);
  });

  it("a malformed listing is REJECTED, not read as empty", async () => {
    for (const body of ["not json", '{"unexpected":true}', '"a string"']) {
      expect(
        () => parsePublications(body, "https://rattspraxis.etjanst.domstol.se/x"),
        "Treating a broken response as an empty one would report 'nothing new' on a day the " +
          "service was failing.",
      ).toThrow(/REJECT_LISTING_SHAPE/);
    }
  });

  it("a non-2xx listing page is REJECTED", async () => {
    const failing: DownloadTransport = {
      async get() {
        return { status: 503, bytes: new Uint8Array(), headers: {} };
      },
    };

    await expect(
      new PuhRattspraxisTargetResolver(failing).resolve(source()),
    ).rejects.toThrow(/REJECT_LISTING_STATUS/);
  });

  it("accepts the POST /sok envelope shape too", () => {
    const parsed = parsePublications(
      JSON.stringify({ total: 1, publiceringLista: [publication("p1", [])] }),
      "https://rattspraxis.etjanst.domstol.se/x",
    );
    expect(parsed).toHaveLength(1);
  });

  // ------------------------------------------------------------------ NO OWN FETCH

  it("the adapter holds no fetch of its own", () => {
    const src = readFileSync(
      join(REPO_ROOT, "packages", "mps-data-governance", "src", "PuhRattspraxisResolver.ts"),
      "utf8",
    );

    expect(
      /\bfetch\s*\(|axios\.|https?\.request\(/.test(src),
      "P2-AUTH-00 closed the class of adapters that reach the network directly. Listing pages " +
        "go through the injected governed transport like everything else.",
    ).toBe(false);
  });

  it("withPaging never rewrites the approved scope parameters", () => {
    const paged = new URL(withPaging(ENDPOINT, 7, 50));

    expect(paged.searchParams.get("page")).toBe("7");
    expect(paged.searchParams.get("pagesize")).toBe("50");
    expect(paged.searchParams.get("domstolkod")).toBe("MMOD");
    expect(paged.searchParams.get("publiceringstyper")).toBe("dom_eller_beslut");
  });

  // ---------------------------------------------------------------- REGISTRY WIRING

  it("the adapter is selected by the signed adapter identifier", async () => {
    const src = source();
    const transport = transportOf([[publication("p1", [{ id: "a", name: "a.pdf" }])]]);

    const registry = new DownloadTargetResolverRegistry(
      {
        registryPath: "<test>",
        sources: [src],
        getSource: (id) => (id === src.sourceId ? src : null),
        isUrlAllowedForSource: (id, url) =>
          id === src.sourceId ? isUrlAllowedForVerifiedSource(src, url) : false,
      },
      { PUH_RATTSPRAXIS_V1: new PuhRattspraxisTargetResolver(transport) },
    );

    const targets = targetsOf(
      await registry.resolve({
        source_id: "domstolsverket-puh-mmod",
        execution_id: "exec-puh-1",
      }),
    );

    expect(targets).toHaveLength(1);
    expect(src.adapter).toBe("PUH_RATTSPRAXIS_V1");
  });
});
