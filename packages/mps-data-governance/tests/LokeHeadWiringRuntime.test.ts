import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DownloadTargetResolverRegistry } from "../src/DownloadTargetResolvers";
import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import { FileValidatorBindingStore } from "../src/FileValidatorBindingStore";
import { GovernedDownloadExecutor } from "../src/GovernedDownloadExecutor";
import { HarvestOrchestrator } from "../src/HarvestOrchestrator";
import { PRODUCTION_ADAPTER_RESOLVERS } from "../src/HarvestRuntimeCompositionRoot";
import { HttpConditionalHeadExchange } from "../src/HttpConditionalHeadExchange";
import {
  buildPrefetchEvidenceIdentityPayload,
  buildPrefetchEvidenceRef,
  InMemoryPrefetchExecutionEvidenceStore,
  type PrefetchExecutionEvidence,
} from "../src/PrefetchExecutionEvidence";
import { decidePrefetch } from "../src/PrefetchValidator";
import { InMemoryValidatorBindingStore, type ValidatorBindingRecord } from "../src/ValidatorBindingStore";
import {
  LeaseAlreadyHeldError,
  LeaseUnavailableError,
  bindExclusivePipe,
  validatorBindingPipeName,
} from "../src/ValidatorBindingLease";
import { fixtureRegistry, fixtureSource } from "./fixtures/verifiedSourceRegistry";

const LOCATOR = "https://example.test/resource";
const TOKEN = '"etag-T"';
const NOW = "2026-10-07T00:00:00.000Z";
const ROOT = fileURLToPath(new URL(".", import.meta.url));

function binding(): ValidatorBindingRecord {
  return {
    sourceId: "source-a",
    sourceContentHash: "hash-1",
    registryArtifactId: "reg-1",
    locatorIdentity: LOCATOR,
    targetIdentity: `${LOCATOR}\nobject.bin`,
    fileName: "object.bin",
    validatorClass: "STRONG_ETAG",
    validatorToken: TOKEN,
    observedAt: "2020-01-01T00:00:00.000Z",
  };
}

function skipEvidence(observedAt: string): PrefetchExecutionEvidence {
  return {
    canonical_version: "pex-canonical-1",
    execution_id: "exec-pex",
    source_id: "source-a",
    source_content_hash: "hash-1",
    registry_artifact_id: "reg-1",
    download_manifest_ref: null,
    outcomes: [
      {
        outcome: "SKIP",
        target_identity: `${LOCATOR}\nobject.bin`,
        locator_identity: LOCATOR,
        file_name: "object.bin",
        method: "HEAD",
        reason_code: "REMOTE_REPRESENTATION_UNCHANGED",
        validator_class: "STRONG_ETAG",
        validator_token: TOKEN,
        final_url: LOCATOR,
        observed_at: observedAt,
      },
    ],
  };
}

async function issuedPlan() {
  const source = fixtureSource({
    sourceId: "source-a",
    sourceContentHash: "hash-1",
    registryArtifactId: "reg-1",
    adapter: "test_adapter_v1",
    endpointUrl: LOCATOR,
    allowedDomains: ["example.test"],
  });
  const registry = fixtureRegistry(source);
  const plan = await new DownloadTargetResolverRegistry(registry, {
    test_adapter_v1: {
      strongEtagCapabilityDeclaration: "STRONG_ETAG" as const,
      async resolve() {
        return { kind: "TARGETS" as const, targets: [{ url: LOCATOR, file_name: "object.bin" }] };
      },
    },
  }).resolve({ source_id: source.sourceId, execution_id: "exec-wire" });
  if (plan.kind !== "TARGETS") throw new Error("expected targets");
  return { source, registry, target: plan.targets[0]! };
}

function quarantine() {
  return {
    async put(_sourceId: string, _url: string, _fileName: string, bytes: Uint8Array) {
      return {
        quarantine_id: "q-1",
        file_path: "",
        metadata_path: "",
        is_duplicate: false,
        hash: createHash("sha256").update(bytes).digest("hex"),
        bytes,
      };
    },
    async get() { return null; },
    async getMetadata() { return null; },
    async updateStatus() {},
    async list() { return []; },
  };
}

function spawnPipe(pipeName: string, mode: "hold" | "try"): ChildProcess & { collected: Promise<string> } {
  const script = `
    const net = require("node:net");
    const server = net.createServer();
    server.once("error", (error) => {
      process.stdout.write(error.code || "ERR");
      process.exit(2);
    });
    server.listen(process.env.PIPE_NAME, () => {
      process.stdout.write("BOUND");
      if (process.env.MODE === "try") {
        server.close(() => process.exit(0));
        return;
      }
      setInterval(() => {}, 1000);
    });
  `;
  const child = spawn(process.execPath, ["-e", script], {
    env: { ...process.env, PIPE_NAME: pipeName, MODE: mode },
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcess & { collected: Promise<string> };
  child.collected = new Promise((resolve, reject) => {
    let out = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
      if (out.includes("BOUND") || out.includes("EADDRINUSE") || out.includes("ERR")) resolve(out);
    });
    child.on("exit", () => resolve(out));
    child.on("error", reject);
  });
  return child;
}

describe("pex-canonical-1", () => {
  it("ignores observed_at and changes for outcome, token, target, and final URL", () => {
    const first = buildPrefetchEvidenceRef(skipEvidence("2020-01-01T00:00:00.000Z"));
    expect(buildPrefetchEvidenceRef(skipEvidence(NOW)).content_hash.digest).toBe(first.content_hash.digest);

    const tokenBody = skipEvidence(NOW);
    expect(
      buildPrefetchEvidenceRef({
        ...tokenBody,
        outcomes: [{ ...tokenBody.outcomes[0]!, validator_token: '"other"' }],
      }).content_hash.digest,
    ).not.toBe(first.content_hash.digest);

    const targetBody = skipEvidence(NOW);
    expect(
      buildPrefetchEvidenceRef({
        ...targetBody,
        outcomes: [{ ...targetBody.outcomes[0]!, target_identity: `${LOCATOR}\nother.bin` }],
      }).content_hash.digest,
    ).not.toBe(first.content_hash.digest);

    const urlBody = skipEvidence(NOW);
    expect(
      buildPrefetchEvidenceRef({
        ...urlBody,
        outcomes: [{ ...urlBody.outcomes[0]!, final_url: `${LOCATOR}/other` }],
      }).content_hash.digest,
    ).not.toBe(first.content_hash.digest);

    const fetchBody: PrefetchExecutionEvidence = {
      ...skipEvidence(NOW),
      download_manifest_ref: { id: "download-manifest-x", content_hash: { algorithm: "sha256", digest: "ab" } },
      outcomes: [{
        outcome: "FETCH",
        target_identity: `${LOCATOR}\nobject.bin`,
        locator_identity: LOCATOR,
        file_name: "object.bin",
        quarantine_id: "q-1",
        content_hash: "cd",
        byte_length: 2,
      }],
    };
    expect(buildPrefetchEvidenceRef(fetchBody).content_hash.digest).not.toBe(first.content_hash.digest);
    expect(JSON.stringify(buildPrefetchEvidenceIdentityPayload(skipEvidence(NOW)))).not.toContain("observed_at");
  });

  it("keeps the first body when only observed_at differs", async () => {
    const store = new InMemoryPrefetchExecutionEvidenceStore();
    const ref = await store.persist(skipEvidence("2020-01-01T00:00:00.000Z"));
    await store.persist(skipEvidence(NOW));
    expect((await store.resolve(ref))?.outcomes[0]).toMatchObject({ observed_at: "2020-01-01T00:00:00.000Z" });
  });
});

describe("validator binding lease", () => {
  it("gives one pipe per store root and does not put target identity in the name", async () => {
    const left = await mkdtemp(join(tmpdir(), "loke-lease-a-"));
    const right = await mkdtemp(join(tmpdir(), "loke-lease-b-"));
    const leftName = validatorBindingPipeName(left);
    const again = validatorBindingPipeName(`${left}\\`);
    expect(again).toBe(leftName);
    expect(validatorBindingPipeName(right)).not.toBe(leftName);
    expect(leftName.startsWith("\\\\.\\pipe\\loke-v0-validator-binding-")).toBe(true);
    expect(leftName.slice("\\\\.\\pipe\\loke-v0-validator-binding-".length)).toMatch(/^[0-9a-f]{64}$/);
    expect(leftName).not.toContain("object.bin");
    expect(leftName).not.toContain(TOKEN);
  });

  it("rejects a second bind, survives a leftover file, and releases on close", async () => {
    const root = await mkdtemp(join(tmpdir(), "loke-lease-same-"));
    await writeFile(join(root, "stale-lease.json"), JSON.stringify({ pid: 1, observedAt: "1999-01-01T00:00:00.000Z" }));
    const first = await FileValidatorBindingStore.open(root);
    await expect(FileValidatorBindingStore.open(root)).rejects.toBeInstanceOf(LeaseAlreadyHeldError);
    expect(await readFile(join(root, "stale-lease.json"), "utf8")).toContain("1999");
    await first.close();
    const second = await FileValidatorBindingStore.open(root);
    await second.close();
  });

  it("does not treat mkdir or an exclusive file as ownership", async () => {
    const root = await mkdtemp(join(tmpdir(), "loke-lease-file-"));
    await mkdir(join(root, "mkdir-lock"));
    await writeFile(join(root, "excl.lock"), "held", { flag: "wx" });
    const store = await FileValidatorBindingStore.open(root);
    const leaseSource = await readFile(join(ROOT, "../src/ValidatorBindingLease.ts"), "utf8");
    const storeSource = await readFile(join(ROOT, "../src/FileValidatorBindingStore.ts"), "utf8");
    expect(leaseSource).not.toContain("proper-lockfile");
    expect(storeSource).not.toContain("proper-lockfile");
    expect(leaseSource).not.toContain("O_EXCL");
    await store.close();
  });

  it("denies another process while the pipe is held and allows it after release and after kill", async () => {
    const root = await mkdtemp(join(tmpdir(), "loke-lease-proc-"));
    const store = await FileValidatorBindingStore.open(root);
    const denied = spawnPipe(store.pipeName, "try");
    expect(await denied.collected).toContain("EADDRINUSE");
    await store.close();

    const acquired = spawnPipe(validatorBindingPipeName(root), "try");
    expect(await acquired.collected).toContain("BOUND");

    const holder = spawnPipe(validatorBindingPipeName(root), "hold");
    expect(await holder.collected).toContain("BOUND");
    holder.kill();
    await new Promise((resolve) => holder.on("exit", resolve));
    const afterKill = await FileValidatorBindingStore.open(root);
    await afterKill.close();
  });

  it("fails closed when the named pipe cannot be established", async () => {
    await expect(bindExclusivePipe("not-a-windows-pipe")).rejects.toBeInstanceOf(LeaseUnavailableError);
  });

  it("a corrupt record is SIGNAL_UNVERIFIABLE and a token mismatch does not touch", async () => {
    const root = await mkdtemp(join(tmpdir(), "loke-binding-body-"));
    const store = await FileValidatorBindingStore.open(root);
    try {
      await store.replace(binding());
      const [file] = await readdir(root);
      await writeFile(join(root, file!), "{", "utf8");
      const { source, target } = await issuedPlan();
      const unreadable = await decidePrefetch(
        {
          sourceId: source.sourceId,
          sourceContentHash: source.sourceContentHash,
          registryArtifactId: source.registryArtifactId,
          adapterId: source.adapter,
          strongEtagAuthority: target.strongEtagAuthority ?? null,
          locatorIdentity: LOCATOR,
          targetIdentity: `${LOCATOR}\nobject.bin`,
          fileName: "object.bin",
          fileNameDeclared: true,
          validatorClass: "STRONG_ETAG",
          method: "HEAD",
          performLiveExchange: false,
        },
        store,
        null,
        () => NOW,
      );
      expect(unreadable).toEqual({ decision: "FETCH", reasonCode: "SIGNAL_UNVERIFIABLE" });

      await writeFile(join(root, file!), JSON.stringify(binding()), "utf8");
      expect(await store.touchObservedAt(binding().sourceId, LOCATOR, binding().targetIdentity, NOW, '"nope"')).toBe(false);
      expect((await store.resolve(binding().sourceId, LOCATOR, binding().targetIdentity))[0]?.observedAt).toBe(
        "2020-01-01T00:00:00.000Z",
      );
    } finally {
      await store.close();
    }
  });
});

describe("conditional HEAD exchange", () => {
  function fetchOf(responses: Response[]) {
    const calls: { method: string; url: string; ifNoneMatch: string | null }[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? "GET",
        url: String(input),
        ifNoneMatch: new Headers(init?.headers).get("if-none-match"),
      });
      const next = responses.shift();
      if (!next) throw new Error("no response");
      return next;
    }) as typeof fetch;
    return { impl, calls };
  }

  it("sends one HEAD If-None-Match and keeps a null body with Content-Length", async () => {
    const { impl, calls } = fetchOf([
      new Response(null, { status: 304, headers: { etag: TOKEN, "content-length": "123" } }),
    ]);
    const exchange = new HttpConditionalHeadExchange({
      isUrlAllowed: () => true,
      fetchImpl: impl,
    });
    const result = await exchange.exchange({ method: "HEAD", locatorIdentity: LOCATOR, ifNoneMatch: TOKEN });
    expect(result).toEqual({ finalUrl: LOCATOR, status: 304, etag: TOKEN });
    expect(calls).toEqual([{ method: "HEAD", url: LOCATOR, ifNoneMatch: TOKEN }]);
  });

  it("refuses 301, 302, and 303 without a second request", async () => {
    for (const status of [301, 302, 303]) {
      const { impl, calls } = fetchOf([
        new Response(null, { status, headers: { location: "https://example.test/next" } }),
      ]);
      const exchange = new HttpConditionalHeadExchange({ isUrlAllowed: () => true, fetchImpl: impl });
      const result = await exchange.exchange({ method: "HEAD", locatorIdentity: LOCATOR, ifNoneMatch: TOKEN });
      expect(result.failure).toBe("unsupported");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe("HEAD");
    }
  });

  it("cancels a non-null HEAD body and does not read it", async () => {
    let read = false;
    let cancelled = false;
    const body = {
      async cancel() {
        cancelled = true;
      },
      getReader() {
        read = true;
        throw new Error("HEAD body was read");
      },
    };
    const { impl } = fetchOf([
      { status: 200, headers: new Headers({ etag: TOKEN }), body } as Response,
    ]);
    const exchange = new HttpConditionalHeadExchange({ isUrlAllowed: () => true, fetchImpl: impl });
    const result = await exchange.exchange({ method: "HEAD", locatorIdentity: LOCATOR, ifNoneMatch: TOKEN });
    expect(result.failure).toBe("unsupported");
    expect(cancelled).toBe(true);
    expect(read).toBe(false);
  });

  it("lets a thrown HEAD stay a throw", async () => {
    const exchange = new HttpConditionalHeadExchange({
      isUrlAllowed: () => true,
      fetchImpl: (async () => {
        throw new Error("timeout");
      }) as typeof fetch,
    });
    await expect(
      exchange.exchange({ method: "HEAD", locatorIdentity: LOCATOR, ifNoneMatch: TOKEN }),
    ).rejects.toThrow(/timeout/);
  });

  it("follows 307 as HEAD and records the terminal URL", async () => {
    const next = "https://example.test/moved";
    const { impl, calls } = fetchOf([
      new Response(null, { status: 307, headers: { location: next } }),
      new Response(null, { status: 304, headers: { etag: TOKEN } }),
    ]);
    const exchange = new HttpConditionalHeadExchange({ isUrlAllowed: () => true, fetchImpl: impl });
    const result = await exchange.exchange({ method: "HEAD", locatorIdentity: LOCATOR, ifNoneMatch: TOKEN });
    expect(result).toEqual({ finalUrl: next, status: 304, etag: TOKEN });
    expect(calls.map((call) => call.method)).toEqual(["HEAD", "HEAD"]);
    expect(calls[1]?.url).toBe(next);
  });

  it("returns scope without fetching when the locator is outside the predicate", async () => {
    let called = false;
    const exchange = new HttpConditionalHeadExchange({
      isUrlAllowed: () => false,
      fetchImpl: (async () => {
        called = true;
        return new Response(null, { status: 200 });
      }) as typeof fetch,
    });
    const result = await exchange.exchange({ method: "HEAD", locatorIdentity: LOCATOR, ifNoneMatch: TOKEN });
    expect(result.failure).toBe("scope");
    expect(called).toBe(false);
  });
});

describe("governed download wiring", () => {
  it("production adapters do not declare STRONG_ETAG", () => {
    const transport = { async get() { throw new Error("unused"); } };
    for (const factory of Object.values(PRODUCTION_ADAPTER_RESOLVERS)) {
      const resolver = factory(transport);
      expect(
        "strongEtagCapabilityDeclaration" in resolver &&
          (resolver as { strongEtagCapabilityDeclaration?: string }).strongEtagCapabilityDeclaration,
      ).not.toBe("STRONG_ETAG");
    }
  });

  it("an all-SKIP run returns prefetch evidence and does not GET", async () => {
    const { source, registry } = await issuedPlan();
    const store = new InMemoryValidatorBindingStore();
    await store.replace({ ...binding(), observedAt: NOW });
    let got = 0;
    const manifests = new InMemoryDownloadManifestStore();
    const evidence = new InMemoryPrefetchExecutionEvidenceStore();
    const executor = new GovernedDownloadExecutor(
      registry,
      {
        async resolve() {
          const plan = await issuedPlan();
          return { kind: "TARGETS" as const, targets: [plan.target] };
        },
      },
      { async get() { got += 1; return { status: 200, bytes: Uint8Array.of(1), headers: {} }; } },
      quarantine() as never,
      manifests,
      { now: () => NOW },
      async () => {},
      {
        bindingStore: store,
        prefetchEvidenceStore: evidence,
        headExchange: {
          async exchange() {
            return { finalUrl: LOCATOR, status: 304, etag: TOKEN };
          },
        },
      },
    );
    const outcome = await executor.execute({
      dataset_ref: { id: source.sourceId, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
      execution_id: "exec-skip",
      requested_at: NOW,
    });
    expect(outcome.kind).toBe("PREFETCH_EVIDENCE");
    expect(got).toBe(0);
    if (outcome.kind !== "PREFETCH_EVIDENCE") return;
    const body = await evidence.resolve(outcome.ref);
    expect(body?.download_manifest_ref).toBeNull();
    expect(body?.outcomes).toHaveLength(1);
    expect(body?.outcomes[0]?.outcome).toBe("SKIP");
  });

  it("a failed replace tombstones the old token and still fails the episode", async () => {
    const root = await mkdtemp(join(tmpdir(), "loke-replace-tombstone-"));
    const store = await FileValidatorBindingStore.open(root);
    const manifests = new InMemoryDownloadManifestStore();
    let manifestsPersisted = 0;
    const countingManifests = {
      async persist(manifest: Parameters<InMemoryDownloadManifestStore["persist"]>[0]) {
        manifestsPersisted += 1;
        return manifests.persist(manifest);
      },
      resolve: (reference: Parameters<InMemoryDownloadManifestStore["resolve"]>[0]) => manifests.resolve(reference),
    };
    try {
      await store.replace(binding());
      const before = await store.resolve(binding().sourceId, LOCATOR, binding().targetIdentity);
      expect(before.map((record) => record.validatorToken)).toEqual([TOKEN]);

      const internal = store as unknown as {
        writeBody(key: string, body: unknown): Promise<void>;
      };
      const original = internal.writeBody.bind(store);
      let recordWrites = 0;
      let tombstones = 0;
      internal.writeBody = async (key, body) => {
        const tombstone =
          typeof body === "object" &&
          body !== null &&
          (body as { tombstone?: unknown }).tombstone === true;
        if (tombstone) {
          tombstones += 1;
          return original(key, body);
        }
        recordWrites += 1;
        throw new Error("ENOSPC");
      };

      const { source, registry, target } = await issuedPlan();
      let got = 0;
      const executor = new GovernedDownloadExecutor(
        registry,
        { async resolve() { return { kind: "TARGETS" as const, targets: [target] }; } },
        {
          async get() {
            got += 1;
            return {
              status: 200,
              bytes: Uint8Array.of(1, 2),
              headers: { etag: '"etag-U"' },
              finalUrl: LOCATOR,
            };
          },
        },
        quarantine() as never,
        countingManifests,
        { now: () => NOW },
        async () => {},
        { bindingStore: store, headExchange: null },
      );

      let returned = false;
      await expect(
        executor.execute({
          dataset_ref: { id: source.sourceId, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
          execution_id: "exec-tombstone",
          requested_at: NOW,
        }).then((outcome) => {
          returned = true;
          return outcome;
        }),
      ).rejects.toThrow(/ENOSPC/);

      expect(returned).toBe(false);
      expect(recordWrites).toBe(1);
      expect(tombstones).toBe(1);
      expect(got).toBe(1);
      expect(manifestsPersisted).toBe(0);
      await expect(store.resolve(binding().sourceId, LOCATOR, binding().targetIdentity)).rejects.toThrow(/tombstoned/);

      const reuse = await decidePrefetch(
        {
          sourceId: source.sourceId,
          sourceContentHash: source.sourceContentHash,
          registryArtifactId: source.registryArtifactId,
          adapterId: source.adapter,
          strongEtagAuthority: target.strongEtagAuthority ?? null,
          locatorIdentity: LOCATOR,
          targetIdentity: `${LOCATOR}\nobject.bin`,
          fileName: "object.bin",
          fileNameDeclared: true,
          validatorClass: "STRONG_ETAG",
          method: "HEAD",
          performLiveExchange: true,
        },
        store,
        { async exchange() { return { finalUrl: LOCATOR, status: 304, etag: TOKEN }; } },
        () => NOW,
      );
      expect(reuse).toEqual({ decision: "FETCH", reasonCode: "SIGNAL_UNVERIFIABLE" });
    } finally {
      await store.close();
    }
  });

  it("an unauthorized HEAD does not GET", async () => {
    const { source, registry, target } = await issuedPlan();
    const store = new InMemoryValidatorBindingStore();
    await store.replace(binding());
    let got = 0;
    const executor = new GovernedDownloadExecutor(
      registry,
      { async resolve() { return { kind: "TARGETS" as const, targets: [target] }; } },
      { async get() { got += 1; return { status: 200, bytes: Uint8Array.of(1), headers: {} }; } },
      quarantine() as never,
      new InMemoryDownloadManifestStore(),
      { now: () => NOW },
      async () => {},
      {
        bindingStore: store,
        headExchange: { async exchange() { return { finalUrl: LOCATOR, status: 401, etag: null }; } },
      },
    );
    await expect(
      executor.execute({
        dataset_ref: { id: source.sourceId, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
        execution_id: "exec-auth",
        requested_at: NOW,
      }),
    ).rejects.toThrow(/UPSTREAM_UNAUTHORIZED/);
    expect(got).toBe(0);
  });

  it("a direct SCOPE_VIOLATION does not GET, write, tombstone, or persist", async () => {
    const root = await mkdtemp(join(tmpdir(), "loke-scope-stop-"));
    const store = await FileValidatorBindingStore.open(root);
    const manifests = new InMemoryDownloadManifestStore();
    let manifestsPersisted = 0;
    const countingManifests = {
      async persist(manifest: Parameters<InMemoryDownloadManifestStore["persist"]>[0]) {
        manifestsPersisted += 1;
        return manifests.persist(manifest);
      },
      resolve: (reference: Parameters<InMemoryDownloadManifestStore["resolve"]>[0]) => manifests.resolve(reference),
    };
    try {
      await store.replace(binding());
      const [file] = await readdir(root);
      const before = await readFile(join(root, file!), "utf8");
      const { source, registry, target } = await issuedPlan();
      let got = 0;
      let puts = 0;
      const executor = new GovernedDownloadExecutor(
        registry,
        { async resolve() { return { kind: "TARGETS" as const, targets: [target] }; } },
        { async get() { got += 1; return { status: 200, bytes: Uint8Array.of(1), headers: {} }; } },
        {
          ...quarantine(),
          async put() {
            puts += 1;
            return quarantine().put("", "", "", Uint8Array.of(1));
          },
        } as never,
        countingManifests,
        { now: () => NOW },
        async () => {},
        {
          bindingStore: store,
          headExchange: {
            async exchange() {
              return { finalUrl: LOCATOR, status: 0, etag: null, failure: "scope" as const };
            },
          },
        },
      );

      await expect(
        executor.execute({
          dataset_ref: { id: source.sourceId, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
          execution_id: "exec-scope",
          requested_at: NOW,
        }),
      ).rejects.toThrow(/SCOPE_VIOLATION/);

      expect(got).toBe(0);
      expect(puts).toBe(0);
      expect(manifestsPersisted).toBe(0);
      expect(await readFile(join(root, file!), "utf8")).toBe(before);
      const still = await store.resolve(binding().sourceId, LOCATOR, binding().targetIdentity);
      expect(still.map((record) => record.validatorToken)).toEqual([TOKEN]);
    } finally {
      await store.close();
    }
  });

  it("writes a binding only after a checksummed GET whose final URL and strong ETag match", async () => {
    const { source, registry, target } = await issuedPlan();
    const store = new InMemoryValidatorBindingStore();
    const executor = new GovernedDownloadExecutor(
      registry,
      { async resolve() { return { kind: "TARGETS" as const, targets: [target] }; } },
      {
        async get() {
          return {
            status: 200,
            bytes: Uint8Array.of(1, 2),
            headers: { etag: TOKEN },
            finalUrl: LOCATOR,
          };
        },
      },
      quarantine() as never,
      new InMemoryDownloadManifestStore(),
      { now: () => NOW },
      async () => {},
      { bindingStore: store, headExchange: null },
    );
    const request = {
      dataset_ref: { id: source.sourceId, content_hash: { algorithm: "sha256" as const, digest: "0".repeat(64) } },
      execution_id: "exec-bind",
      requested_at: NOW,
    };
    const outcome = await executor.execute(request);
    expect(outcome.kind).toBe("DOWNLOAD_MANIFEST");
    const written = await store.resolve(source.sourceId, LOCATOR, `${LOCATOR}\nobject.bin`);
    expect(written).toHaveLength(1);
    expect(written[0]?.validatorToken).toBe(TOKEN);

    const diverted = new InMemoryValidatorBindingStore();
    const noBind = new GovernedDownloadExecutor(
      registry,
      { async resolve() { return { kind: "TARGETS" as const, targets: [target] }; } },
      {
        async get() {
          return {
            status: 200,
            bytes: Uint8Array.of(1, 2),
            headers: { etag: 'W/"weak"' },
            finalUrl: "https://example.test/elsewhere",
          };
        },
      },
      quarantine() as never,
      new InMemoryDownloadManifestStore(),
      { now: () => NOW },
      async () => {},
      { bindingStore: diverted, headExchange: null },
    );
    expect((await noBind.execute({ ...request, execution_id: "exec-nobind" })).kind).toBe("DOWNLOAD_MANIFEST");
    expect(await diverted.resolve(source.sourceId, LOCATOR, `${LOCATOR}\nobject.bin`)).toEqual([]);
  });

  it("a mixed run persists only fetched objects and returns prefetch evidence", async () => {
    const { source, registry } = await issuedPlan();
    const other = "https://example.test/other";
    const store = new InMemoryValidatorBindingStore();
    await store.replace(binding());
    const manifests = new InMemoryDownloadManifestStore();
    const evidence = new InMemoryPrefetchExecutionEvidenceStore();
    const gets: string[] = [];
    const executor = new GovernedDownloadExecutor(
      registry,
      {
        async resolve() {
          const plan = await issuedPlan();
          return {
            kind: "TARGETS" as const,
            targets: [
              plan.target,
              { url: other, file_name: "other.bin" },
            ],
          };
        },
      },
      {
        async get(url: string) {
          gets.push(url);
          return { status: 200, bytes: Uint8Array.of(9), headers: {}, finalUrl: url };
        },
      },
      quarantine() as never,
      manifests,
      { now: () => NOW },
      async () => {},
      {
        bindingStore: store,
        prefetchEvidenceStore: evidence,
        headExchange: {
          async exchange(request) {
            return { finalUrl: request.locatorIdentity, status: 304, etag: TOKEN };
          },
        },
      },
    );
    const outcome = await executor.execute({
      dataset_ref: { id: source.sourceId, content_hash: { algorithm: "sha256" as const, digest: "0".repeat(64) } },
      execution_id: "exec-mixed",
      requested_at: NOW,
    });
    expect(outcome.kind).toBe("PREFETCH_EVIDENCE");
    expect(gets).toEqual([other]);
    if (outcome.kind !== "PREFETCH_EVIDENCE") return;
    const body = await evidence.resolve(outcome.ref);
    expect(body?.outcomes.map((item) => item.outcome).sort()).toEqual(["FETCH", "SKIP"]);
    expect(body?.download_manifest_ref).not.toBeNull();
    const manifest = await manifests.resolve(body!.download_manifest_ref!);
    expect(manifest?.objects).toHaveLength(1);
    expect(manifest?.objects[0]?.url).toBe(other);
  });

  it("waits between HEAD and the following GET", async () => {
    const source = fixtureSource({
      sourceId: "source-a",
      sourceContentHash: "hash-1",
      registryArtifactId: "reg-1",
      adapter: "test_adapter_v1",
      endpointUrl: LOCATOR,
      allowedDomains: ["example.test"],
      policy: {
        rate_limit_requests_per_second: 0,
        concurrency_limit: 1,
        politeness_delay_ms: 40,
        max_object_size_bytes: 1_000_000,
        retry_policy: { max_attempts: 1, backoff: "FIXED" },
      },
    });
    const registry = fixtureRegistry(source);
    const plan = await new DownloadTargetResolverRegistry(registry, {
      test_adapter_v1: {
        strongEtagCapabilityDeclaration: "STRONG_ETAG" as const,
        async resolve() {
          return { kind: "TARGETS" as const, targets: [{ url: LOCATOR, file_name: "object.bin" }] };
        },
      },
    }).resolve({ source_id: source.sourceId, execution_id: "exec-polite" });
    if (plan.kind !== "TARGETS") throw new Error("expected targets");
    const target = plan.targets[0]!;
    const store = new InMemoryValidatorBindingStore();
    await store.replace(binding());
    const slept: number[] = [];
    const executor = new GovernedDownloadExecutor(
      registry,
      { async resolve() { return { kind: "TARGETS" as const, targets: [target] }; } },
      { async get() { return { status: 200, bytes: Uint8Array.of(1), headers: {}, finalUrl: LOCATOR }; } },
      quarantine() as never,
      new InMemoryDownloadManifestStore(),
      { now: () => NOW },
      async (ms: number) => { slept.push(ms); },
      {
        bindingStore: store,
        headExchange: { async exchange() { return { finalUrl: LOCATOR, status: 200, etag: TOKEN }; } },
      },
    );
    await executor.execute({
      dataset_ref: { id: source.sourceId, content_hash: { algorithm: "sha256" as const, digest: "0".repeat(64) } },
      execution_id: "exec-polite",
      requested_at: NOW,
    });
    expect(slept).toEqual([40]);
  });

  it("records prefetch evidence without calling verification", async () => {
    const ref = { id: "prefetch-evidence-exec", content_hash: { algorithm: "sha256" as const, digest: "ab" } };
    const checkpoints = new Map<string, unknown>();
    let harvested = 0;
    let verified = 0;
    const orchestrator = new HarvestOrchestrator(
      { async execute() { harvested += 1; return { kind: "PREFETCH_EVIDENCE" as const, ref }; } },
      { async verify() { verified += 1; throw new Error("verification"); } },
      { async run() { return []; } },
      { async evaluate() { throw new Error("gate"); } } as never,
      { async project() { throw new Error("project"); } },
      { async initialize() { throw new Error("lu"); } },
      {
        async load(id: string) { return (checkpoints.get(id) as never) ?? null; },
        async save(id: string, checkpoint: unknown) { checkpoints.set(id, checkpoint); },
      },
      { now: () => NOW },
    );
    const request = {
      dataset_ref: { id: "source-a", content_hash: { algorithm: "sha256" as const, digest: "0".repeat(64) } },
      execution_id: "exec-orch",
      requested_at: NOW,
    };
    const first = await orchestrator.execute(request);
    expect(first.state).toBe("PREFETCH_EVIDENCE_RECORDED");
    expect(first.produced_artifacts).toEqual([ref]);
    expect(first.evidence_refs).toEqual([]);
    expect(verified).toBe(0);
    const saved = checkpoints.get("exec-orch") as { manifest_ref?: unknown; prefetch_evidence_ref?: unknown };
    expect(saved.manifest_ref).toBeUndefined();
    expect(saved.prefetch_evidence_ref).toEqual(ref);
    const second = await orchestrator.execute(request);
    expect(second.state).toBe("PREFETCH_EVIDENCE_RECORDED");
    expect(harvested).toBe(1);
    expect(verified).toBe(0);
  });
});
