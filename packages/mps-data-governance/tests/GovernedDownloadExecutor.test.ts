import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";

import { GovernedDownloadExecutor } from "../src/GovernedDownloadExecutor";
import { GovernedDownloadError } from "../src/GovernedDownloadContracts";
import type {
  DownloadTarget,
  DownloadTargetResolver,
  DownloadTransport,
} from "../src/GovernedDownloadContracts";
import type { VerifiedSourceDefinition, VerifiedSourceRegistry } from "../src/SourceRegistry";
import { isUrlAllowedForVerifiedSource } from "../src/SourceRegistry";
import type { QuarantineStorage, RawSourceArtifact } from "@miljobeslut/mimers-brunn-core";

/**
 * ✅ P2-DOWNLOAD — GOVERNED DOWNLOAD PIPELINE PROOF.
 *
 *   Invariant under test:
 *     Downloaded bytes SHALL land in quarantine under the approved source's own policy, and
 *     SHALL NOT acquire any promotion authority on the way.
 *
 *   The class implements the existing `HarvestExecutor` port, which had no production
 *   implementation before this unit — only mocks. Authority stays where it already was: the
 *   verified SourceRegistry decides what is approved and in scope, and the orchestrator owns
 *   the state machine.
 *
 *   Out of scope and untouched: CAS promotion, import gate, LU, HM1-D/CI.
 */
describe("P2-DOWNLOAD — governed download pipeline", () => {
  const BYTES = new TextEncoder().encode("<gml>beslut</gml>");
  const HASH = createHash("sha256").update(BYTES).digest("hex");

  function source(overrides: Partial<VerifiedSourceDefinition> = {}): VerifiedSourceDefinition {
    return {
      sourceId: "lst-beslut",
      authority: { name: "Länsstyrelsen", type: "county_board" },
      endpointUrl: "https://data.lansstyrelsen.se/wfs",
      adapter: "wfs",
      frequency: "daily",
      allowedDomains: ["data.lansstyrelsen.se"],
      artifactTypes: ["DECISION"],
      policy: {
        rate_limit_requests_per_second: 0,
        concurrency_limit: 1,
        politeness_delay_ms: 0,
        max_object_size_bytes: 1_000_000,
        retry_policy: { max_attempts: 3, backoff: "FIXED" },
      },
      registryArtifactId: "src-lst-beslut-v1",
      sourceContentHash: "a".repeat(64),
      ...overrides,
    };
  }

  function registryOf(def: VerifiedSourceDefinition | null): VerifiedSourceRegistry {
    return {
      registryPath: "/tmp/registry.json",
      sources: def ? [def] : [],
      getSource: (id) => (def && def.sourceId === id ? def : null),
      isUrlAllowedForSource: (id, url) =>
        def && def.sourceId === id ? isUrlAllowedForVerifiedSource(def, url) : false,
    };
  }

  function resolverOf(...targets: DownloadTarget[]): DownloadTargetResolver {
    return { resolve: async () => targets };
  }

  /** Records everything landed; has no promote/CAS surface, exactly like the real port. */
  function fakeQuarantine() {
    const stored = new Map<string, { bytes: Uint8Array; meta: RawSourceArtifact }>();
    const byHash = new Map<string, string>();
    const storage: QuarantineStorage = {
      async put(sourceId, sourceUrl, fileName, bytes) {
        const hash = createHash("sha256").update(bytes).digest("hex");
        const existing = byHash.get(hash);
        if (existing) {
          return {
            quarantine_id: existing,
            file_path: `/q/${existing}`,
            metadata_path: `/q/${existing}.json`,
            is_duplicate: true,
            hash,
          };
        }
        const id = `q-${stored.size + 1}`;
        byHash.set(hash, id);
        stored.set(id, {
          bytes,
          meta: {
            quarantine_id: id,
            source_id: sourceId,
            source_url: sourceUrl,
            file_name: fileName,
            retrieved_at: "2026-08-13T10:00:00.000Z",
            content_hash: hash,
            status: "quarantined",
          },
        });
        return {
          quarantine_id: id,
          file_path: `/q/${id}`,
          metadata_path: `/q/${id}.json`,
          is_duplicate: false,
          hash,
        };
      },
      async get(id) {
        return stored.get(id)?.bytes ?? null;
      },
      async getMetadata(id) {
        return stored.get(id)?.meta ?? null;
      },
      async updateStatus() {},
      async list() {
        return [...stored.values()].map((v) => v.meta);
      },
    };
    return { storage, stored };
  }

  const clock = { now: () => "2026-08-13T10:00:00.000Z" };
  let requested: string[];
  let slept: number[];

  beforeEach(() => {
    requested = [];
    slept = [];
  });

  function transportOf(
    handler: (url: string, attempt: number) => { status: number; bytes: Uint8Array },
  ): DownloadTransport {
    const attempts = new Map<string, number>();
    return {
      async get(url) {
        const n = (attempts.get(url) ?? 0) + 1;
        attempts.set(url, n);
        requested.push(url);
        const r = handler(url, n);
        return { status: r.status, bytes: r.bytes, headers: {} };
      },
    };
  }

  function build(opts: {
    source: VerifiedSourceDefinition | null;
    targets: DownloadTarget[];
    transport: DownloadTransport;
    quarantine?: QuarantineStorage;
  }) {
    const q = opts.quarantine ?? fakeQuarantine().storage;
    return new GovernedDownloadExecutor(
      registryOf(opts.source),
      resolverOf(...opts.targets),
      opts.transport,
      q,
      clock,
      async (ms) => {
        slept.push(ms);
      },
    );
  }

  const request = {
    dataset_ref: { id: "lst-beslut", content_hash: { algorithm: "sha256", digest: "b".repeat(64) } },
    execution_id: "exec-1",
    requested_at: "2026-08-13T09:00:00.000Z",
  };

  const target: DownloadTarget = {
    url: "https://data.lansstyrelsen.se/wfs?req=beslut",
    file_name: "beslut.gml",
  };

  // ------------------------------------------------------------------ HAPPY PATH

  it("lands bytes in quarantine and returns a manifest reference", async () => {
    const q = fakeQuarantine();
    const exec = build({
      source: source(),
      targets: [target],
      transport: transportOf(() => ({ status: 200, bytes: BYTES })),
      quarantine: q.storage,
    });

    const manifestRef = await exec.execute(request);

    expect(manifestRef.content_hash.digest).toHaveLength(64);
    expect(q.stored.size).toBe(1);
    const [landed] = [...q.stored.values()];
    expect(landed.meta.content_hash).toBe(HASH);
    expect(
      landed.meta.status,
      "P2: downloaded bytes land quarantined. Anything else would mean the pipeline granted " +
        "itself promotion authority.",
    ).toBe("quarantined");
  });

  it("the executor holds no promotion surface at all", () => {
    const exec = build({
      source: source(),
      targets: [target],
      transport: transportOf(() => ({ status: 200, bytes: BYTES })),
    });

    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(exec)).filter(
      (n) => n !== "constructor" && !n.startsWith("_"),
    );
    expect(
      surface.filter((n) => !n.startsWith("#")),
      "P2: the class exposes exactly one operation. Promotion authority is absent by " +
        "construction — it is given no CAS port, no import gate and no signing key.",
    ).toEqual(["execute"]);
  });

  // -------------------------------------------------------------------- GOVERNANCE

  it("an unapproved / unknown source is REJECTED before any request is issued", async () => {
    const exec = build({
      source: null,
      targets: [target],
      transport: transportOf(() => ({ status: 200, bytes: BYTES })),
    });

    await expect(exec.execute(request)).rejects.toThrow(/REJECT_SOURCE/);
    expect(
      requested,
      "P2: approval is checked before the network is touched. The verified registry only " +
        "yields APPROVED sources, so an unknown id means 'not approved'.",
    ).toEqual([]);
  });

  it("a URL outside the source's allowed domains is REJECTED, and nothing is fetched first", async () => {
    const exec = build({
      source: source(),
      targets: [
        target,
        { url: "https://evil.example.com/x.gml", file_name: "x.gml" },
      ],
      transport: transportOf(() => ({ status: 200, bytes: BYTES })),
    });

    await expect(exec.execute(request)).rejects.toThrow(/REJECT_URL_SCOPE/);
    expect(
      requested,
      "P2: every URL is validated up front. Validating lazily would let the in-scope targets " +
        "be fetched before the out-of-scope one is caught.",
    ).toEqual([]);
  });

  it("an object over the source's size limit is REJECTED", async () => {
    const big = new Uint8Array(2048);
    const exec = build({
      source: source({
        policy: { ...source().policy, max_object_size_bytes: 1024 },
      }),
      targets: [target],
      transport: transportOf(() => ({ status: 200, bytes: big })),
    });

    await expect(exec.execute(request)).rejects.toThrow(/REJECT_OBJECT_SIZE/);
  });

  it("an empty plan is REJECTED rather than manifested as a successful run of nothing", async () => {
    const exec = build({
      source: source(),
      targets: [],
      transport: transportOf(() => ({ status: 200, bytes: BYTES })),
    });

    await expect(exec.execute(request)).rejects.toThrow(/REJECT_EMPTY_PLAN/);
  });

  // ------------------------------------------------------------ RETRY / IDEMPOTENCY

  it("a transient HTTP failure is retried under the source's retry policy", async () => {
    const exec = build({
      source: source(),
      targets: [target],
      transport: transportOf((_url, attempt) =>
        attempt < 3 ? { status: 503, bytes: new Uint8Array() } : { status: 200, bytes: BYTES },
      ),
    });

    await expect(exec.execute(request)).resolves.toBeDefined();
    expect(requested).toHaveLength(3);
    expect(slept.length).toBe(2);
  });

  it("exhausted retries FAIL CLOSED — no partial manifest", async () => {
    const q = fakeQuarantine();
    const exec = build({
      source: source(),
      targets: [target],
      transport: transportOf(() => ({ status: 500, bytes: new Uint8Array() })),
      quarantine: q.storage,
    });

    await expect(exec.execute(request)).rejects.toThrow(/REJECT_RETRIES_EXHAUSTED/);
    expect(
      q.stored.size,
      "P2: a manifest that omitted a failed object would claim a complete harvest of an " +
        "incomplete one.",
    ).toBe(0);
  });

  it("a governance rejection is NOT retried — a refusal is a decision, not a fault", async () => {
    const exec = build({
      source: source({ policy: { ...source().policy, max_object_size_bytes: 4 } }),
      targets: [target],
      transport: transportOf(() => ({ status: 200, bytes: BYTES })),
    });

    await expect(exec.execute(request)).rejects.toThrow(/REJECT_OBJECT_SIZE/);
    expect(
      requested,
      "Retrying an out-of-policy response would turn a governance refusal into a delay.",
    ).toHaveLength(1);
  });

  it("re-running the same execution yields the SAME manifest reference", async () => {
    const q = fakeQuarantine();
    const make = () =>
      build({
        source: source(),
        targets: [target],
        transport: transportOf(() => ({ status: 200, bytes: BYTES })),
        quarantine: q.storage,
      });

    const first = await make().execute(request);
    const second = await make().execute(request);

    expect(
      second.content_hash.digest,
      "P2: `generated_at` is excluded from the manifest hash, so an identical re-run is " +
        "recognisable as the same download. Including wall-clock time would make idempotency " +
        "unobservable.",
    ).toBe(first.content_hash.digest);
    expect(q.stored.size, "identical bytes are deduplicated in quarantine").toBe(1);
  });

  it("changing the source content hash changes the manifest identity", async () => {
    const q = fakeQuarantine();
    const run = (def: VerifiedSourceDefinition) =>
      build({
        source: def,
        targets: [target],
        transport: transportOf(() => ({ status: 200, bytes: BYTES })),
        quarantine: q.storage,
      }).execute(request);

    const a = await run(source());
    const b = await run(source({ sourceContentHash: "c".repeat(64) }));

    expect(
      b.content_hash.digest,
      "P2: the manifest binds WHICH registry entry authorised the run. A re-approved source " +
        "with different policy must not produce an identical manifest.",
    ).not.toBe(a.content_hash.digest);
  });

  it("a checksum disagreement between fetch and storage FAILS CLOSED", async () => {
    const lying: QuarantineStorage = {
      ...fakeQuarantine().storage,
      async put() {
        return {
          quarantine_id: "q-bad",
          file_path: "/q/q-bad",
          metadata_path: "/q/q-bad.json",
          is_duplicate: false,
          hash: "d".repeat(64),
        };
      },
    };

    const exec = build({
      source: source({ policy: { ...source().policy, retry_policy: { max_attempts: 1, backoff: "FIXED" } } }),
      targets: [target],
      transport: transportOf(() => ({ status: 200, bytes: BYTES })),
      quarantine: lying,
    });

    await expect(
      exec.execute(request),
      "P2: if stored bytes are not the verified bytes, nothing downstream can be trusted to " +
        "notice.",
    ).rejects.toThrow(/REJECT_CHECKSUM/);
  });

  it("rejections carry a machine-readable reason code", async () => {
    const exec = build({
      source: null,
      targets: [target],
      transport: transportOf(() => ({ status: 200, bytes: BYTES })),
    });

    await exec.execute(request).catch((e) => {
      expect(e).toBeInstanceOf(GovernedDownloadError);
      expect((e as GovernedDownloadError).reason_code).toBe("REJECT_SOURCE");
    });
  });
});
