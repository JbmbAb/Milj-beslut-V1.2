import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  type QuarantinePutResult,
  type QuarantineStorage,
  type RawSourceArtifact,
} from "@miljobeslut/mimers-brunn-core";

import { approveSourceRegistryEntry } from "../src/SourceApproval";
import { unsignedDraftFixture } from "./fixtures/unsignedSourceRegistryDrafts";
import {
  composeHarvestRuntime,
  PRODUCTION_ADAPTER_RESOLVERS,
  type AdapterResolverFactory,
} from "../src/HarvestRuntimeCompositionRoot";
import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import {
  getSourceRegistryPathFromEnv,
  getSourceRegistryVerificationKeyFromEnv,
  type SourceRegistryArtifact,
} from "../src/SourceRegistry";

import type { Clock, HarvestExecutor } from "../src/HarvestOrchestratorContracts";
import type { HarvestExecutionRequest } from "../src/HarvestOrchestratorTypes";

/**
 * ✅ P2-RUNTIME-01 — OFFLINE PRODUCTION COMPOSITION ROOT.
 *
 *   Invariant under test:
 *     The production harvest runtime can be assembled from the repo-resolved APPROVED authority
 *     with VERIFICATION capability only. `SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM` MUST NOT BE
 *     REQUIRED — and the minting path must not be reachable from the root at all.
 *
 *   The gap this closes: every piece of the governed pipeline existed, but nothing in production
 *   ever wired them together. The only assemblies lived inside test files, so the wiring — which
 *   is where capability leaks in — was never itself reviewable. `tests/fixtures/verifiedSourceRegistry.ts`
 *   says so explicitly: "the composition root is deliberately not built yet, precisely so this
 *   shortcut cannot leak into it."
 *
 *   ⚠️ OFFLINE. No test in this file contacts a network. Where a request is exercised, `fetchImpl`
 *   is injected and asserted on. Live harvest is P2-HARVEST-LIVE-01, which this unit unblocks.
 *
 *   ⚠️ FIXTURE KEYS ONLY. Every key is generated inside this file. The GOVERNOR private key is
 *   never read.
 *
 *   @see ../src/HarvestRuntimeCompositionRoot.ts
 *   @see ./P2SRVerifyOnly01.test.ts (the capability split this builds on)
 */
describe("P2-RUNTIME-01 — offline production composition root", () => {
  const REPO_ROOT = resolve(__dirname, "../../..");
  const ROOT_SRC = join(__dirname, "..", "src", "HarvestRuntimeCompositionRoot.ts");
  const AUTHORITY_PATH = join(REPO_ROOT, "source-registry", "national-registry.json");

  const KEY_ID = "ed25519:test-governor";
  const APPROVER = "governor:test-owner";

  const PUH_SOURCE = "domstolsverket-puh-mmod";
  const SFS_SOURCE = "regeringskansliet-sfs-1998-808";
  const SFS_ENDPOINT = "https://rkrattsbaser.gov.se/sfst?bet=1998:808";
  /** An approved domain — but approved for the OTHER source. */
  const PUH_DOMAIN_URL = "https://rattspraxis.etjanst.domstol.se/api/v1/bilagor/x";

  const fixedClock: Clock = { now: () => "2026-08-14T00:00:00.000Z" };

  // ------------------------------------------------------------------ fixtures

  /**
   * A signed two-source registry on disk, built with a fixture key.
   *
   * Two sources on purpose: a single-source registry cannot show whether transport scope is
   * bound per source or to the union of everything approved.
   *
   * Written to a temp directory, never into the repo — this test must not be able to produce
   * something mistakable for the GOVERNOR-signed authority.
   */
  async function signedRegistryFile(): Promise<{
    path: string;
    publicKey: string;
    privateKey: string;
    keyId: string;
  }> {
    const generated = LocalPemSigningKeyProvider.generate(KEY_ID);

    const approved: SourceRegistryArtifact[] = [];
    // Tracked fixtures, not source-registry/drafts/: that directory is the owner's signing
    // workspace and is gitignored, so reading it made this proof fail in a clean checkout.
    for (const draft of [unsignedDraftFixture("puh"), unsignedDraftFixture("sfs")]) {
      approved.push(
        await approveSourceRegistryEntry({
          entry: draft,
          approver_actor_id: APPROVER,
          signing: generated.provider,
        }),
      );
    }

    const dir = mkdtempSync(join(tmpdir(), "p2-runtime-01-"));
    const path = join(dir, "registry.json");
    writeFileSync(path, JSON.stringify(approved, null, 2) + "\n", "utf8");

    return {
      path,
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
      keyId: KEY_ID,
    };
  }

  function verifyOnly(signed: { keyId: string; publicKey: string }) {
    return new LocalPemVerificationKeyProvider(signed.keyId, signed.publicKey);
  }

  /** In-memory quarantine, so no test writes into the repo's `.quarantine`. */
  class MemoryQuarantineStorage implements QuarantineStorage {
    readonly puts: { sourceId: string; url: string; bytes: Uint8Array }[] = [];

    async put(
      sourceId: string,
      sourceUrl: string,
      _fileName: string,
      bytes: Uint8Array,
    ): Promise<QuarantinePutResult> {
      this.puts.push({ sourceId, url: sourceUrl, bytes });
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(bytes).digest("hex");
      return {
        quarantine_id: `q-${this.puts.length}`,
        file_path: `/memory/${hash}.bin`,
        metadata_path: `/memory/${hash}.metadata.json`,
        is_duplicate: false,
        hash,
      };
    }

    async get(): Promise<Uint8Array | null> {
      return null;
    }
    async getMetadata(): Promise<RawSourceArtifact | null> {
      return null;
    }
    async updateStatus(): Promise<void> {}
    async list(): Promise<readonly RawSourceArtifact[]> {
      return [];
    }
  }

  /** Records every call, so "made no network contact" is an assertion and not a hope. */
  function recordingFetch(handler: (url: string) => Response): {
    impl: typeof fetch;
    calls: string[];
  } {
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      return handler(url);
    }) as typeof fetch;
    return { impl, calls };
  }

  function requestFor(sourceId: string): HarvestExecutionRequest {
    return {
      dataset_ref: { id: sourceId, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
      execution_id: `exec-${sourceId}`,
      requested_at: "2026-08-14T00:00:00.000Z",
    };
  }

  async function withEnv(
    env: Record<string, string | undefined>,
    fn: () => Promise<void>,
  ): Promise<void> {
    const names = [
      "SOURCE_REGISTRY_SIGNING_KEY_ID",
      "SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM",
      "SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM",
      "SOURCE_REGISTRY_ARTIFACT_PATH",
    ];
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    try {
      for (const n of names) {
        const value = env[n];
        if (value === undefined) delete process.env[n];
        else process.env[n] = value;
      }
      await fn();
    } finally {
      for (const n of names) {
        const value = saved[n];
        if (value === undefined) delete process.env[n];
        else process.env[n] = value;
      }
    }
  }

  /**
   * The composition root's import statements.
   *
   * The structural claims below are about the IMPORT GRAPH, so they are asserted against imports
   * rather than against the whole file — the doc comment names the forbidden symbols in prose in
   * order to explain why they are absent, and prose must not be able to fail a structural test.
   */
  function importSection(): string {
    const contents = readFileSync(ROOT_SRC, "utf8");
    return (contents.match(/^import[\s\S]*?from\s*["'][^"']+["'];/gm) ?? []).join("\n");
  }

  /** The file with comments removed, for claims about executable code. */
  function executableSource(): string {
    return readFileSync(ROOT_SRC, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  // ------------------------------------------- 1. REPO-RESOLVED APPROVED AUTHORITY

  it("1. loads the repo-resolved APPROVED authority and resolves approved sources", async () => {
    const signed = await signedRegistryFile();

    const { registry } = await composeHarvestRuntime({
      registryPath: signed.path,
      signing: verifyOnly(signed),
      quarantine: new MemoryQuarantineStorage(),
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      clock: fixedClock,
    });

    expect(registry.sources.map((s) => s.sourceId).sort()).toEqual([PUH_SOURCE, SFS_SOURCE]);
    expect(registry.getSource(SFS_SOURCE)?.adapter).toBe("SINGLE_ENDPOINT_V1");
    expect(registry.getSource(PUH_SOURCE)?.adapter).toBe("PUH_RATTSPRAXIS_V1");
    // Only APPROVED entries can materialize — `verifySourceRegistryArtifact` refuses anything
    // else — so every source reaching the runtime carries a verified GOVERNOR attestation.
    expect(registry.getSource("never-registered")).toBeNull();
  });

  it("1b. with no explicit path, the root resolves the repo authority file itself", async () => {
    await withEnv(
      {
        SOURCE_REGISTRY_SIGNING_KEY_ID: undefined,
        SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM: undefined,
        SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM: undefined,
        SOURCE_REGISTRY_ARTIFACT_PATH: undefined,
      },
      async () => {
        expect(getSourceRegistryPathFromEnv()).toBe(resolve(AUTHORITY_PATH));
      },
    );

    // Proving the root ACCEPTS the real authority needs the real public key, which is the
    // owner's to supply. What is provable here is that the default path reaches signature
    // verification against that exact file rather than failing earlier — i.e. the root really
    // does resolve and read the repo authority.
    const other = LocalPemSigningKeyProvider.generate(
      "ed25519:source-registry-governor-2026-08-14",
    );

    await expect(
      composeHarvestRuntime({
        signing: new LocalPemVerificationKeyProvider(
          "ed25519:source-registry-governor-2026-08-14",
          other.publicKey,
        ),
        registryPath: AUTHORITY_PATH,
        quarantine: new MemoryQuarantineStorage(),
        downloadManifestStore: new InMemoryDownloadManifestStore(),
      }),
    ).rejects.toThrow(/signature_valid/);
  });

  // ------------------------------------- 2. COMPOSES WITHOUT THE GOVERNOR PRIVATE KEY

  it("2. composes with SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM absent from the environment", async () => {
    const signed = await signedRegistryFile();

    await withEnv(
      {
        SOURCE_REGISTRY_SIGNING_KEY_ID: signed.keyId,
        SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM: signed.publicKey,
        SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM: undefined,
        SOURCE_REGISTRY_ARTIFACT_PATH: signed.path,
      },
      async () => {
        // No `signing` and no `registryPath`: exactly the defaults production uses.
        const { executor, registry } = await composeHarvestRuntime({
          quarantine: new MemoryQuarantineStorage(),
          downloadManifestStore: new InMemoryDownloadManifestStore(),
          clock: fixedClock,
        });

        expect(
          registry.sources,
          "This is the core invariant of the ticket. A harvest host must be able to assemble the " +
            "full runtime holding only the key id and the PUBLIC key.",
        ).toHaveLength(2);
        expect(executor).toBeDefined();
        expect(process.env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM).toBeUndefined();
      },
    );
  });

  // --------------------------------------- 3. VERIFICATION CAPABILITY, NOT SIGNING

  it("3. the key provider the root defaults to has no sign capability", async () => {
    const signed = await signedRegistryFile();

    await withEnv(
      {
        SOURCE_REGISTRY_SIGNING_KEY_ID: signed.keyId,
        SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM: signed.publicKey,
        // Present on purpose: the runtime must not become a signer just because the material
        // happens to be sitting in its environment.
        SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM: signed.privateKey,
        SOURCE_REGISTRY_ARTIFACT_PATH: signed.path,
      },
      async () => {
        const provider = getSourceRegistryVerificationKeyFromEnv();
        expect("sign" in provider).toBe(false);

        const { registry } = await composeHarvestRuntime({
          quarantine: new MemoryQuarantineStorage(),
          downloadManifestStore: new InMemoryDownloadManifestStore(),
          clock: fixedClock,
        });
        expect(registry.sources).toHaveLength(2);
      },
    );
  });

  it("3b. the root's declared key port is VerificationKeyProvider, never SigningKeyProvider", () => {
    const imports = importSection();

    expect(imports).toMatch(/\bVerificationKeyProvider\b/);
    expect(
      /\bSigningKeyProvider\b/.test(imports),
      "Accepting a SigningKeyProvider would put minting capability inside the runtime's own type.",
    ).toBe(false);
  });

  // ------------------------------------------- 4. NO SIGNING PATH REACHABLE FROM ROOT

  it("4. no approve-source or signing path is reachable from the composition root", () => {
    const imports = importSection();

    const forbidden = [
      "SourceApproval",
      "approveSourceRegistryEntry",
      "getSourceRegistrySigningKeyFromEnv",
      "LocalPemSigningKeyProvider",
      "createArtifactAttestation",
    ];

    const reachable = forbidden.filter((symbol) => new RegExp(`\\b${symbol}\\b`).test(imports));

    expect(
      reachable,
      "P2-RUNTIME-01: the runtime must be unable to mint an approval because it was never handed " +
        "the capability. Absence from the import graph is what makes that structural rather than " +
        "a rule someone has to keep remembering.",
    ).toEqual([]);
  });

  // ---------------------------------------------------- 5. UNKNOWN ADAPTER FAILS CLOSED

  it("5. an adapter with no registered resolver fails closed, with no request issued", async () => {
    const signed = await signedRegistryFile();
    const fetchStub = recordingFetch(() => new Response("unreachable", { status: 200 }));

    const { executor } = await composeHarvestRuntime({
      registryPath: signed.path,
      signing: verifyOnly(signed),
      quarantine: new MemoryQuarantineStorage(),
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      clock: fixedClock,
      fetchImpl: fetchStub.impl,
      // PUH_RATTSPRAXIS_V1 deliberately withheld.
      adapters: { SINGLE_ENDPOINT_V1: PRODUCTION_ADAPTER_RESOLVERS.SINGLE_ENDPOINT_V1 },
    });

    await expect(executor.execute(requestFor(PUH_SOURCE))).rejects.toThrow(/REJECT_ADAPTER/);

    expect(
      fetchStub.calls,
      "A silent fallback to 'just fetch the endpoint' would harvest a source with an adapter it " +
        "was never approved for, and the manifest would not show it.",
    ).toEqual([]);
  });

  it("5b. an unknown source id is refused before any transport is built", async () => {
    const signed = await signedRegistryFile();
    const fetchStub = recordingFetch(() => new Response("unreachable", { status: 200 }));

    const { executor } = await composeHarvestRuntime({
      registryPath: signed.path,
      signing: verifyOnly(signed),
      quarantine: new MemoryQuarantineStorage(),
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      clock: fixedClock,
      fetchImpl: fetchStub.impl,
    });

    await expect(executor.execute(requestFor("not-in-the-registry"))).rejects.toThrow(
      /REJECT_SOURCE/,
    );
    expect(fetchStub.calls).toEqual([]);
  });

  // ------------------------------------- 6. TRANSPORT BOUND TO SOURCE-SPECIFIC SCOPE

  it("6. transport scope is bound per source, not to the union of approved domains", async () => {
    const signed = await signedRegistryFile();

    // A redirect from the SFS source onto the PUH source's domain. Both are approved — but not
    // for each other. A shared transport would have to accept the union and let this through.
    const fetchStub = recordingFetch((url) =>
      url.startsWith(SFS_ENDPOINT)
        ? new Response(null, { status: 302, headers: { location: PUH_DOMAIN_URL } })
        : new Response("should never be reached", { status: 200 }),
    );

    const { executor } = await composeHarvestRuntime({
      registryPath: signed.path,
      signing: verifyOnly(signed),
      quarantine: new MemoryQuarantineStorage(),
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      clock: fixedClock,
      fetchImpl: fetchStub.impl,
    });

    await expect(
      executor.execute(requestFor(SFS_SOURCE)),
      "rattspraxis.etjanst.domstol.se is approved for domstolsverket-puh-mmod, not for " +
        "regeringskansliet-sfs-1998-808. Scope is a property of the source.",
    ).rejects.toThrow(/REJECT_REDIRECT_SCOPE/);

    expect(fetchStub.calls).toEqual([SFS_ENDPOINT]);
  });

  // ------------------------------------------------- 7. NO FETCH IN THE ROOT ITSELF

  it("7. the composition root issues no request of its own", () => {
    const code = executableSource();

    const networkCall = /\bfetch\s*\(|axios\.|got\(|https?\.request\(|new\s+XMLHttpRequest/;
    expect(
      networkCall.test(code),
      "Networking belongs to HttpDownloadTransport, which re-validates every redirect hop. A " +
        "request issued from the root would bypass that check entirely.",
    ).toBe(false);

    // Composing must also not touch a network at runtime, not merely avoid the literal call.
    expect(code).toContain("loadVerifiedSourceRegistry");
  });

  it("7b. composing the runtime makes no network contact at all", async () => {
    const signed = await signedRegistryFile();
    const fetchStub = recordingFetch(() => {
      throw new Error("composition must not reach a network");
    });

    const { executor } = await composeHarvestRuntime({
      registryPath: signed.path,
      signing: verifyOnly(signed),
      quarantine: new MemoryQuarantineStorage(),
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      clock: fixedClock,
      fetchImpl: fetchStub.impl,
    });

    expect(executor).toBeDefined();
    expect(
      fetchStub.calls,
      "P2-RUNTIME-01 is the offline unit. The first request belongs to P2-HARVEST-LIVE-01.",
    ).toEqual([]);
  });

  // --------------------------- 8. NO IMPORT GATE, CAS PROMOTION OR SIGNING AUTHORITY

  it("8. the root holds no import gate, CAS promotion or signing authority", () => {
    const imports = importSection();

    const forbidden = [
      "ImportGate",
      "QuarantinePromoter",
      "DatasetApproval",
      "ContentAddressableStore",
      "CasRepository",
    ];

    const reachable = forbidden.filter((symbol) => new RegExp(`\\b${symbol}\\b`).test(imports));

    expect(
      reachable,
      "Landing zone is quarantine. Promotion authority must be absent by construction — a root " +
        "that could reach CAS could promote bytes that were never gated.",
    ).toEqual([]);

    // Quarantine is the only storage port the root wires in.
    expect(imports).toMatch(/\bQuarantineStorage\b|\bDiskQuarantineStorage\b/);
  });

  // ------------------------------------------------- 9. NO TEST FIXTURES IN THE ROOT

  it("9. the composition root imports nothing from tests or fixtures", () => {
    const imports = importSection();

    const specifiers = [...imports.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]);
    const offending = specifiers.filter((s) => /(^|\/)tests?(\/|$)|[Ff]ixture/.test(s));

    expect(
      offending,
      "tests/fixtures/verifiedSourceRegistry.ts builds a VerifiedSourceRegistry directly, " +
        "skipping attestation verification entirely. It exists on the explicit condition that it " +
        "never reaches the composition root.",
    ).toEqual([]);

    expect(specifiers.length).toBeGreaterThan(0);
  });

  // ----------------------------------------------- 10. SATISFIES THE HarvestExecutor PORT

  it("10. the composed runtime satisfies the HarvestExecutor port end to end", async () => {
    const signed = await signedRegistryFile();
    const quarantine = new MemoryQuarantineStorage();
    const payload = new TextEncoder().encode("<html>SFS 1998:808</html>");
    const fetchStub = recordingFetch(() => new Response(payload, { status: 200 }));

    const { executor } = await composeHarvestRuntime({
      registryPath: signed.path,
      signing: verifyOnly(signed),
      quarantine,
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      clock: fixedClock,
      fetchImpl: fetchStub.impl,
    });

    // Type-level: the port is structural, so this assignment IS the conformance proof.
    const asPort: HarvestExecutor = executor;
    const manifestRef = await asPort.execute(requestFor(SFS_SOURCE));

    expect(manifestRef.content_hash.algorithm).toBe("sha256");
    expect(manifestRef.content_hash.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(manifestRef.id).toContain(`download-manifest-exec-${SFS_SOURCE}`);

    expect(fetchStub.calls).toEqual([SFS_ENDPOINT]);
    expect(quarantine.puts).toHaveLength(1);
    expect(quarantine.puts[0].sourceId).toBe(SFS_SOURCE);
    expect(quarantine.puts[0].url).toBe(SFS_ENDPOINT);
  });

  it("10b. identity is reproducible — an identical re-run yields the identical manifest ref", async () => {
    const signed = await signedRegistryFile();
    const payload = new TextEncoder().encode("<html>SFS 1998:808</html>");

    const run = async () => {
      const { executor } = await composeHarvestRuntime({
        registryPath: signed.path,
        signing: verifyOnly(signed),
        quarantine: new MemoryQuarantineStorage(),
        downloadManifestStore: new InMemoryDownloadManifestStore(),
        clock: fixedClock,
        fetchImpl: recordingFetch(() => new Response(payload, { status: 200 })).impl,
      });
      return executor.execute(requestFor(SFS_SOURCE));
    };

    expect(
      (await run()).content_hash.digest,
      "Replay equality is what makes a governed harvest auditable at all.",
    ).toBe((await run()).content_hash.digest);
  });

  // --------------------------------------------- adapters the root is willing to run

  it("registers only adapters that an approved source actually names", () => {
    expect(Object.keys(PRODUCTION_ADAPTER_RESOLVERS).sort()).toEqual([
      "LM_STAC_BYGGNADER_V1",
      "PUH_RATTSPRAXIS_V1",
      "SINGLE_ENDPOINT_V1",
    ]);

    const factory: AdapterResolverFactory = PRODUCTION_ADAPTER_RESOLVERS.SINGLE_ENDPOINT_V1;
    expect(typeof factory).toBe("function");
  });
});
