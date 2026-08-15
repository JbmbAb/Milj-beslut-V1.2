import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

import { GovernedDownloadExecutor } from "../src/GovernedDownloadExecutor";
import {
  DownloadTargetResolverRegistry,
  WfsCapabilitiesTargetResolver,
} from "../src/DownloadTargetResolvers";
import { PuhRattspraxisTargetResolver } from "../src/PuhRattspraxisResolver";
import type {
  DownloadTargetResolver,
  DownloadTransport,
  ResolvedDownloadPlan,
} from "../src/GovernedDownloadContracts";
import { isUrlAllowedForVerifiedSource, type VerifiedSourceDefinition } from "../src/SourceRegistry";
import type { QuarantineStorage, RawSourceArtifact } from "@miljobeslut/mimers-brunn-core";

/**
 * ✅ P2-EMPTY-PLAN-01 — LEGITIMATE EMPTY HARVEST SEMANTICS.
 *
 *   Invariant under test:
 *     `[]` still does not mean success. A run may succeed with nothing downloaded only when the
 *     resolver reports a verified NO_CHANGES observation, and that run leaves an auditable
 *     manifest.
 *
 *   The distinction is generic. The executor tells the two apart by what the resolver claims to
 *   have seen, never by which adapter produced it — an adapter-specific branch would mean one
 *   source is permitted to come back empty, which is not a rule.
 */
describe("P2-EMPTY-PLAN-01 — legitimate empty harvest", () => {
  const ENDPOINT =
    "https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar" +
    "?domstolkod=MMOD&publiceringstyper=dom_eller_beslut&publicerad_fran_och_med=2025-03-04";

  function source(overrides: Partial<VerifiedSourceDefinition> = {}): VerifiedSourceDefinition {
    return {
      sourceId: "domstolsverket-puh-mmod",
      authority: { name: "Domstolsverket", type: "other" },
      endpointUrl: ENDPOINT,
      adapter: "PUH_RATTSPRAXIS_V1",
      frequency: "daily",
      allowedDomains: ["rattspraxis.etjanst.domstol.se"],
      artifactTypes: ["decision"],
      policy: {
        rate_limit_requests_per_second: 0,
        concurrency_limit: 1,
        politeness_delay_ms: 0,
        max_object_size_bytes: 52_428_800,
        retry_policy: { max_attempts: 1, backoff: "FIXED" },
      },
      registryArtifactId: "reg-dv-puh-mmod-001",
      sourceContentHash: "a".repeat(64),
      ...overrides,
    };
  }

  function registryOf(def: VerifiedSourceDefinition) {
    return {
      registryPath: "<test>",
      sources: [def],
      getSource: (id: string) => (def.sourceId === id ? def : null),
      isUrlAllowedForSource: (id: string, url: string) =>
        def.sourceId === id ? isUrlAllowedForVerifiedSource(def, url) : false,
    };
  }

  /** Records every write so a no-op run can be proven to have written nothing. */
  function recordingQuarantine() {
    const stored = new Map<string, Uint8Array>();
    const storage: QuarantineStorage = {
      async put(_s, _u, _f, bytes) {
        const hash = createHash("sha256").update(bytes).digest("hex");
        stored.set(hash, bytes);
        return {
          quarantine_id: `q-${stored.size}`,
          file_path: "/q",
          metadata_path: "/q.json",
          is_duplicate: false,
          hash,
        };
      },
      async get() {
        return null;
      },
      async getMetadata() {
        return null as RawSourceArtifact | null;
      },
      async updateStatus() {},
      async list() {
        return [];
      },
    };
    return { storage, stored };
  }

  const clock = { now: () => "2026-08-14T06:00:00.000Z" };
  const request = {
    dataset_ref: {
      id: "domstolsverket-puh-mmod",
      content_hash: { algorithm: "sha256", digest: "b".repeat(64) },
    },
    execution_id: "exec-quiet-day",
    requested_at: "2026-08-14T06:00:00.000Z",
  };

  function build(resolver: DownloadTargetResolver, quarantine?: QuarantineStorage) {
    const q = quarantine ?? recordingQuarantine().storage;
    const transport: DownloadTransport = {
      async get() {
        throw new Error("the executor must not fetch anything on a no-change run");
      },
    };
    return new GovernedDownloadExecutor(
      registryOf(source()),
      resolver,
      transport,
      q,
      clock,
      async () => {},
    );
  }

  function planOf(plan: ResolvedDownloadPlan): DownloadTargetResolver {
    return { async resolve() { return plan; } };
  }

  const validEvidence = {
    pages_examined: 1,
    items_observed: 0,
    targets_produced: 0,
    listing_url: ENDPOINT,
  };

  // ------------------------------------------------------------------- 1. NO_CHANGES

  it("a verified no-change observation succeeds, downloads nothing and writes nothing", async () => {
    const q = recordingQuarantine();
    const exec = build(planOf({ kind: "NO_CHANGES", evidence: validEvidence }), q.storage);

    const manifestRef = await exec.execute(request);

    expect(manifestRef.content_hash.digest).toHaveLength(64);
    expect(
      q.stored.size,
      "A quiet day must leave the archive untouched. The run succeeded; nothing was collected.",
    ).toBe(0);
  });

  it("the no-change run is auditable — a manifest exists, so 'ran, nothing new' is not 'never ran'", async () => {
    const exec = build(planOf({ kind: "NO_CHANGES", evidence: validEvidence }));
    const ref = await exec.execute(request);

    expect(ref.id).toContain("exec-quiet-day");
    expect(
      ref.content_hash.digest,
      "Without a manifest the two are the same absence, and nobody can tell afterwards whether " +
        "the job ran at all.",
    ).toBeTruthy();
  });

  // ------------------------------------------------------------------ 2. BARE EMPTY

  it("a resolver that just returns [] is still REJECTED", async () => {
    const exec = build(planOf({ kind: "TARGETS", targets: [] }));

    await expect(
      exec.execute(request),
      "Emptiness alone cannot mean success. A resolver that produced nothing without saying it " +
        "verified nothing is indistinguishable from a broken one.",
    ).rejects.toThrow(/REJECT_EMPTY_PLAN/);
  });

  // ------------------------------------------------------- 3. UNFALSIFIABLE CLAIMS

  it("a no-change claim without a single examined page is REJECTED", async () => {
    const exec = build(
      planOf({ kind: "NO_CHANGES", evidence: { ...validEvidence, pages_examined: 0 } }),
    );

    await expect(
      exec.execute(request),
      "That is a resolver that did not look, not a source with nothing new.",
    ).rejects.toThrow(/REJECT_NO_CHANGES_EVIDENCE/);
  });

  it("a no-change claim reporting targets is REJECTED", async () => {
    const exec = build(
      planOf({ kind: "NO_CHANGES", evidence: { ...validEvidence, targets_produced: 3 } }),
    );

    await expect(exec.execute(request)).rejects.toThrow(/REJECT_NO_CHANGES_EVIDENCE/);
  });

  it("a no-change claim naming nothing consulted is REJECTED", async () => {
    const exec = build(
      planOf({ kind: "NO_CHANGES", evidence: { ...validEvidence, listing_url: "" } }),
    );

    await expect(
      exec.execute(request),
      "An untraceable claim cannot be checked against the approved scope.",
    ).rejects.toThrow(/REJECT_NO_CHANGES_EVIDENCE/);
  });

  // ------------------------------------------------------------- 4. PUH END TO END

  it("PUH reports NO_CHANGES on an empty listing, and TARGETS when something is published", async () => {
    const listing = (items: unknown[]): DownloadTransport => ({
      async get() {
        return {
          status: 200,
          bytes: new TextEncoder().encode(JSON.stringify(items)),
          headers: {},
        };
      },
    });

    const quiet = await new PuhRattspraxisTargetResolver(listing([])).resolve(source());
    expect(quiet.kind).toBe("NO_CHANGES");
    if (quiet.kind === "NO_CHANGES") {
      expect(quiet.evidence.pages_examined).toBe(1);
      expect(quiet.evidence.items_observed).toBe(0);
      expect(quiet.evidence.listing_url).toContain("domstolkod=MMOD");
    }

    // Publications with no attachments is also an ordinary day, not a fault.
    const noAttachments = await new PuhRattspraxisTargetResolver(
      listing([{ id: "p1", bilagaLista: [] }]),
    ).resolve(source());
    expect(noAttachments.kind).toBe("NO_CHANGES");
    if (noAttachments.kind === "NO_CHANGES") {
      expect(noAttachments.evidence.items_observed).toBe(1);
      expect(noAttachments.evidence.targets_produced).toBe(0);
    }

    const busy = await new PuhRattspraxisTargetResolver(
      listing([{ id: "p1", bilagaLista: [{ fillagringId: "a", filnamn: "dom.pdf" }] }]),
    ).resolve(source());
    expect(busy.kind).toBe("TARGETS");
  });

  it("a malformed listing still FAILS rather than becoming a no-change day", async () => {
    const broken: DownloadTransport = {
      async get() {
        return { status: 200, bytes: new TextEncoder().encode("<html>maintenance</html>"), headers: {} };
      },
    };

    await expect(
      new PuhRattspraxisTargetResolver(broken).resolve(source()),
      "A broken service must not be reported as a quiet day — that is the failure mode this " +
        "whole unit exists to keep separate.",
    ).rejects.toThrow(/REJECT_LISTING_SHAPE/);
  });

  // ------------------------------------------------------------ 5. WFS UNCHANGED

  it("WFS empty-plan behaviour is unchanged — still fail-closed", async () => {
    const emptyCapabilities: DownloadTransport = {
      async get() {
        return {
          status: 200,
          bytes: new TextEncoder().encode('<?xml version="1.0"?><WFS_Capabilities version="2.0.0"/>'),
          headers: {},
        };
      },
    };

    await expect(
      new WfsCapabilitiesTargetResolver(emptyCapabilities).resolve(
        source({ adapter: "wfs_v1", endpointUrl: "https://rattspraxis.etjanst.domstol.se/wfs" }),
      ),
      "A capabilities document advertising nothing is a broken service, not a quiet day. WFS " +
        "must never gain NO_CHANGES by accident.",
    ).rejects.toThrow(/REJECT_CAPABILITIES/);
  });

  // ------------------------------------------------- 6. NO ADAPTER BRANCH IN EXECUTOR

  it("the executor contains no adapter-specific branch", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, resolve: resolvePath } = await import("node:path");
    const src = readFileSync(
      join(
        resolvePath(__dirname, "../../.."),
        "packages",
        "mps-data-governance",
        "src",
        "GovernedDownloadExecutor.ts",
      ),
      "utf8",
    );

    expect(
      /PUH|puh|RATTSPRAXIS|domstol|WFS_|wfs_/.test(src),
      "The moment the executor knows one source is allowed to come back empty, the rule stops " +
        "being a rule. The distinction lives in the plan, not in a list of adapters.",
    ).toBe(false);
  });

  it("the registry passes the plan through without collapsing it", async () => {
    const src = source();
    const registry = new DownloadTargetResolverRegistry(registryOf(src), {
      PUH_RATTSPRAXIS_V1: {
        async resolve() {
          return { kind: "NO_CHANGES", evidence: validEvidence } as ResolvedDownloadPlan;
        },
      },
    });

    const plan = await registry.resolve({
      source_id: src.sourceId,
      execution_id: "exec-passthrough",
    });

    expect(plan.kind).toBe("NO_CHANGES");
  });
});
