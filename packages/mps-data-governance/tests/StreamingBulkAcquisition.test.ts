import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiskQuarantineStorage, StreamingQuarantineError } from "@miljobeslut/mimers-brunn-core";

import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import {
  GovernedDownloadExecutor,
  STREAMING_HEADER_AND_IDLE_TIMEOUT_MS,
} from "../src/GovernedDownloadExecutor";
import type { DownloadManifest, DownloadTarget } from "../src/GovernedDownloadContracts";
import { requireDownloadManifestRef } from "../src/HarvestOrchestratorContracts";
import { HttpDownloadTransport } from "../src/HttpDownloadTransport";
import { LantmaterietStacByggnaderAssetTransport } from "../src/LantmaterietStacByggnaderAssetTransport";
import { isUrlAllowedForVerifiedSource, type VerifiedSourceDefinition, type VerifiedSourceRegistry } from "../src/SourceRegistry";

const IN_MEMORY_BUDGET = 64 * 1024;
const CHUNK = 16 * 1024;
const LARGE_TOTAL = IN_MEMORY_BUDGET * 8;
const ASSET_URL = "https://dl1.lantmateriet.se/byggnadsverk/byggnad_kn2482.zip";
const TOKEN = "test-lm-building-token";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loke-stream-"));
  roots.push(root);
  return root;
}

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
      retry_policy: { max_attempts: 1, backoff: "FIXED" },
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

function patternChunk(offset: number, length: number): Uint8Array {
  const chunk = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) chunk[i] = (offset + i) % 251;
  return chunk;
}

function hashPattern(total: number): string {
  const hash = createHash("sha256");
  let offset = 0;
  while (offset < total) {
    const length = Math.min(CHUNK, total - offset);
    hash.update(patternChunk(offset, length));
    offset += length;
  }
  return hash.digest("hex");
}

function chunkedResponse(
  total: number,
  init: { status?: number; headers?: Record<string, string>; failAfter?: number } = {},
): Response {
  let offset = 0;
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (init.failAfter !== undefined && sent >= init.failAfter) {
        controller.error(new Error("ECONNRESET"));
        return;
      }
      if (offset >= total) {
        controller.close();
        return;
      }
      const length = Math.min(CHUNK, total - offset);
      const chunk = patternChunk(offset, length);
      offset += length;
      sent += 1;
      controller.enqueue(chunk);
    },
  });
  return new Response(stream, { status: init.status ?? 200, headers: init.headers });
}

function httpTransport(fetchImpl: typeof fetch, def = source()) {
  const calls: string[] = [];
  const wrapped = (async (url: string | URL, init?: RequestInit) => {
    calls.push(String(url));
    return fetchImpl(url, init);
  }) as typeof fetch;
  const transport = new HttpDownloadTransport({
    isUrlAllowed: (url) => isUrlAllowedForVerifiedSource(def, url),
    fetchImpl: wrapped,
  });
  return { transport, calls };
}

function observationNames(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => name.endsWith(".bin") || name.endsWith(".metadata.json"));
}

function partialNames(root: string): string[] {
  const incoming = path.join(root, ".incoming");
  if (!fs.existsSync(incoming)) return [];
  return fs.readdirSync(incoming);
}

function executorFor(input: {
  def: VerifiedSourceDefinition | null;
  root: string;
  transport: HttpDownloadTransport | LantmaterietStacByggnaderAssetTransport;
  store?: InMemoryDownloadManifestStore;
  targets?: readonly DownloadTarget[];
}) {
  const def = input.def;
  const store = input.store ?? new InMemoryDownloadManifestStore();
  const target = input.targets ?? [
    {
      url: "https://data.lansstyrelsen.se/wfs?req=beslut",
      file_name: "beslut.gml",
    },
  ];
  const exec = new GovernedDownloadExecutor(
    registryOf(def),
    { resolve: async () => ({ kind: "TARGETS", targets: target }) },
    input.transport,
    new DiskQuarantineStorage(input.root),
    store,
    { now: () => "2026-08-13T10:00:00.000Z" },
    async () => undefined,
  );
  return { exec, store };
}

const requestFor = (id = "lst-beslut") => ({
  dataset_ref: { id, content_hash: { algorithm: "sha256" as const, digest: "b".repeat(64) } },
  execution_id: `exec-${id}`,
  requested_at: "2026-08-13T09:00:00.000Z",
});

describe("L-V1-BULK-BOOTSTRAP-01 streaming acquisition", () => {
  it("streams an object larger than the in-memory budget without assembling it", async () => {
    const root = tempRoot();
    const url = "https://data.lansstyrelsen.se/wfs?req=bulk";
    let bufferedGet = 0;
    const { transport } = httpTransport(async () => chunkedResponse(LARGE_TOTAL));
    transport.get = async () => {
      bufferedGet += 1;
      throw new Error("buffered get must not be used");
    };
    const { exec, store } = executorFor({
      def: source({ policy: { ...source().policy, max_object_size_bytes: LARGE_TOTAL } }),
      root,
      transport,
      targets: [{ url, file_name: "bulk.bin" }],
    });

    const ref = requireDownloadManifestRef(await exec.execute(requestFor()));
    const manifest = await store.resolve(ref);

    expect(bufferedGet).toBe(0);
    expect(manifest?.objects).toHaveLength(1);
    expect(manifest?.objects[0]?.byte_length).toBe(LARGE_TOTAL);
    expect(manifest?.objects[0]?.content_hash).toBe(hashPattern(LARGE_TOTAL));
    expect(manifest?.source_id).toBe("lst-beslut");
    expect(manifest?.source_content_hash).toBe("a".repeat(64));
    expect(manifest?.registry_artifact_id).toBe("src-lst-beslut-v1");
    const landed = fs.statSync(path.join(root, `${manifest?.objects[0]?.quarantine_id}.bin`));
    expect(landed.size).toBe(LARGE_TOTAL);
    expect(partialNames(root)).toEqual([]);
    expect(CHUNK).toBeLessThan(IN_MEMORY_BUDGET);
    expect(LARGE_TOTAL).toBeGreaterThan(IN_MEMORY_BUDGET);
  });

  it("rejects an unknown source before any stream is opened", async () => {
    const root = tempRoot();
    const { transport, calls } = httpTransport(async () => chunkedResponse(CHUNK));
    const { exec, store } = executorFor({ def: null, root, transport });

    await expect(exec.execute(requestFor())).rejects.toThrow(/REJECT_SOURCE/);
    expect(calls).toEqual([]);
    expect(observationNames(root)).toEqual([]);
    expect(store).toBeDefined();
  });

  it("rejects an out-of-scope URL before any stream is opened", async () => {
    const root = tempRoot();
    const { transport, calls } = httpTransport(async () => chunkedResponse(CHUNK));
    const { exec } = executorFor({
      def: source(),
      root,
      transport,
      targets: [{ url: "https://evil.example.com/x.gml", file_name: "x.gml" }],
    });

    await expect(exec.execute(requestFor())).rejects.toThrow(/REJECT_URL_SCOPE/);
    expect(calls).toEqual([]);
    expect(observationNames(root)).toEqual([]);
  });

  it("rejects a declared Content-Length over the limit before the body is pulled", async () => {
    const root = tempRoot();
    const url = "https://data.lansstyrelsen.se/wfs?req=declared";
    const fetchImpl = (async () =>
      new Response(patternChunk(0, 8), {
        status: 200,
        headers: { "content-length": "999999" },
      })) as typeof fetch;
    const { transport } = httpTransport(fetchImpl);
    const { exec, store } = executorFor({
      def: source({ policy: { ...source().policy, max_object_size_bytes: 1000 } }),
      root,
      transport,
      targets: [{ url, file_name: "declared.bin" }],
    });

    await expect(exec.execute(requestFor())).rejects.toThrow(/REJECT_OBJECT_SIZE/);
    expect(observationNames(root)).toEqual([]);
    expect(partialNames(root)).toEqual([]);
    await expect(store.resolve({ id: "absent", content_hash: { algorithm: "sha256", digest: "0".repeat(64) } })).resolves.toBeNull();
  });

  it("rejects a streamed body that grows past the limit when Content-Length is absent", async () => {
    const root = tempRoot();
    const url = "https://data.lansstyrelsen.se/wfs?req=grow";
    const { transport } = httpTransport(async () => chunkedResponse(CHUNK * 4));
    const { exec } = executorFor({
      def: source({ policy: { ...source().policy, max_object_size_bytes: CHUNK + 10 } }),
      root,
      transport,
      targets: [{ url, file_name: "grow.bin" }],
    });

    await expect(exec.execute(requestFor())).rejects.toThrow(/REJECT_OBJECT_SIZE/);
    expect(observationNames(root)).toEqual([]);
    expect(partialNames(root)).toEqual([]);
  });

  it("an interrupted stream leaves no observation and no manifest", async () => {
    const root = tempRoot();
    const url = "https://data.lansstyrelsen.se/wfs?req=cut";
    const store = new InMemoryDownloadManifestStore();
    let persists = 0;
    const persist = store.persist.bind(store);
    store.persist = async (manifest) => {
      persists += 1;
      return persist(manifest);
    };
    const { transport } = httpTransport(async () => chunkedResponse(CHUNK * 4, { failAfter: 1 }));
    const { exec } = executorFor({
      def: source(),
      root,
      transport,
      store,
      targets: [{ url, file_name: "cut.bin" }],
    });

    await expect(exec.execute(requestFor())).rejects.toThrow(/REJECT_RETRIES_EXHAUSTED|REJECT_HTTP_STATUS/);
    expect(persists).toBe(0);
    expect(observationNames(root)).toEqual([]);
    expect(partialNames(root)).toEqual([]);
  });

  it("a disk write failure does not finalize an observation", async () => {
    const root = tempRoot();
    const storage = new DiskQuarantineStorage(root);
    const session = await storage.beginNetworkObservation({
      source_id: "lst-beslut",
      source_url: "https://data.lansstyrelsen.se/wfs?req=disk",
      file_name: "disk.bin",
      max_bytes: 1_000_000,
    });
    const write = vi.spyOn(fs.WriteStream.prototype, "write").mockImplementation(function writeFailed(
      this: fs.WriteStream,
      _chunk: unknown,
      encoding?: unknown,
      cb?: unknown,
    ) {
      const callback = typeof encoding === "function" ? encoding : cb;
      const error = new Error("ENOSPC");
      if (typeof callback === "function") callback(error);
      this.emit("error", error);
      return false;
    });

    await expect(session.write(patternChunk(0, 32))).rejects.toBeInstanceOf(StreamingQuarantineError);
    write.mockRestore();
    expect(observationNames(root)).toEqual([]);
    expect(partialNames(root)).toEqual([]);
  });

  it("a witness/hash mismatch does not finalize an observation or a manifest", async () => {
    const root = tempRoot();
    const storage = new DiskQuarantineStorage(root);
    const session = await storage.beginNetworkObservation({
      source_id: "lst-beslut",
      source_url: "https://data.lansstyrelsen.se/wfs?req=hash",
      file_name: "hash.bin",
    });
    const chunk = patternChunk(0, 64);
    await session.write(chunk);

    await expect(
      session.finalize({ byte_length: chunk.byteLength, content_hash: "d".repeat(64) }),
    ).rejects.toMatchObject({ reason_code: "REJECT_CHECKSUM" });
    expect(observationNames(root)).toEqual([]);
    expect(partialNames(root)).toEqual([]);

    const url = "https://data.lansstyrelsen.se/wfs?req=lying";
    const lyingRoot = tempRoot();
    const real = new DiskQuarantineStorage(lyingRoot);
    const lying = new DiskQuarantineStorage(lyingRoot);
    lying.beginNetworkObservation = async (request) => {
      const inner = await real.beginNetworkObservation(request);
      return {
        write: (part: Uint8Array) => inner.write(part),
        abort: () => inner.abort(),
        async finalize(witness) {
          const landed = await inner.finalize(witness);
          return { ...landed, hash: "e".repeat(64) };
        },
      };
    };
    const { transport } = httpTransport(async () => chunkedResponse(CHUNK));
    const store = new InMemoryDownloadManifestStore();
    let persists = 0;
    const persist = store.persist.bind(store);
    store.persist = async (manifest) => {
      persists += 1;
      return persist(manifest);
    };
    const exec = new GovernedDownloadExecutor(
      registryOf(source()),
      { resolve: async () => ({ kind: "TARGETS", targets: [{ url, file_name: "lying.bin" }] }) },
      transport,
      lying,
      store,
      { now: () => "2026-08-13T10:00:00.000Z" },
      async () => undefined,
    );

    await expect(exec.execute(requestFor())).rejects.toThrow(/REJECT_CHECKSUM/);
    expect(persists).toBe(0);
  });

  it("rejects a zero-byte object and does not quarantine it", async () => {
    const root = tempRoot();
    const url = "https://data.lansstyrelsen.se/wfs?req=empty";
    const { transport } = httpTransport(async () => chunkedResponse(0));
    const { exec } = executorFor({
      def: source(),
      root,
      transport,
      targets: [{ url, file_name: "empty.bin" }],
    });

    await expect(exec.execute(requestFor())).rejects.toThrow(/REJECT_EMPTY_OBJECT/);
    expect(observationNames(root)).toEqual([]);
    expect(partialNames(root)).toEqual([]);
  });

  it("deduplicates identical bytes and keeps a second source's manifest identity distinct", async () => {
    const root = tempRoot();
    const url = "https://data.lansstyrelsen.se/wfs?req=same";
    const store = new InMemoryDownloadManifestStore();
    const seen: DownloadManifest[] = [];
    const persist = store.persist.bind(store);
    store.persist = async (manifest) => {
      seen.push(JSON.parse(JSON.stringify(manifest)) as DownloadManifest);
      return persist(manifest);
    };
    const run = async (def: VerifiedSourceDefinition, fileName: string) => {
      const before = seen.length;
      const { transport } = httpTransport(async () => chunkedResponse(CHUNK), def);
      const { exec } = executorFor({
        def,
        root,
        transport,
        store,
        targets: [{ url, file_name: fileName }],
      });
      await exec.execute(requestFor(def.sourceId));
      const manifest = seen[before];
      if (!manifest) throw new Error("manifest missing");
      return manifest;
    };

    const first = await run(source(), "one.bin");
    const second = await run(source(), "one.bin");
    expect(second.objects[0]?.deduplicated).toBe(true);
    expect(second.objects[0]?.quarantine_id).toBe(first.objects[0]?.quarantine_id);
    expect(second.objects[0]?.content_hash).toBe(first.objects[0]?.content_hash);
    expect(observationNames(root).filter((name) => name.endsWith(".bin"))).toHaveLength(1);

    const other = await run(
      source({
        sourceId: "other-source",
        sourceContentHash: "c".repeat(64),
        registryArtifactId: "src-other-v1",
        allowedDomains: ["data.lansstyrelsen.se"],
      }),
      "other.bin",
    );
    expect(other.source_id).toBe("other-source");
    expect(other.source_content_hash).toBe("c".repeat(64));
    expect(other.registry_artifact_id).toBe("src-other-v1");
    expect(other.objects[0]?.source_id).toBe("other-source");
    expect(other.objects[0]?.file_name).toBe("other.bin");
    expect(other.objects[0]?.deduplicated).toBe(false);
    expect(other.objects[0]?.quarantine_id).not.toBe(first.objects[0]?.quarantine_id);
    expect(other.objects[0]?.content_hash).toBe(first.objects[0]?.content_hash);
    const storage = new DiskQuarantineStorage(root);
    const firstMeta = await storage.getMetadata(first.objects[0]!.quarantine_id);
    const otherMeta = await storage.getMetadata(other.objects[0]!.quarantine_id);
    expect(firstMeta?.source_id).toBe("lst-beslut");
    expect(firstMeta && "source_url" in firstMeta ? firstMeta.source_url : "").toBe(url);
    expect(firstMeta?.file_name).toBe("one.bin");
    expect(otherMeta?.source_id).toBe("other-source");
    expect(otherMeta && "source_url" in otherMeta ? otherMeta.source_url : "").toBe(url);
    expect(otherMeta?.file_name).toBe("other.bin");
    expect(otherMeta?.custom_metadata?.registry_artifact_id).toBe("src-other-v1");
    const firstStat = fs.statSync(path.join(root, `${first.objects[0]!.quarantine_id}.bin`));
    const otherStat = fs.statSync(path.join(root, `${other.objects[0]!.quarantine_id}.bin`));
    expect(otherStat.ino).toBe(firstStat.ino);
  });

  it("reuses a quarantine id only when the provenance binding matches", async () => {
    const root = tempRoot();
    const storage = new DiskQuarantineStorage(root);
    const bytes = patternChunk(0, 64);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const land = async (request: {
      source_id: string;
      source_url: string;
      file_name: string;
      registry_artifact_id: string;
    }) => {
      const session = await storage.beginNetworkObservation({
        source_id: request.source_id,
        source_url: request.source_url,
        file_name: request.file_name,
        max_bytes: 1_000,
        custom_metadata: { registry_artifact_id: request.registry_artifact_id },
      });
      await session.write(bytes);
      return session.finalize({ byte_length: bytes.byteLength, content_hash: hash });
    };

    const base = {
      source_id: "lst-beslut",
      source_url: "https://data.lansstyrelsen.se/wfs?req=same",
      file_name: "one.bin",
      registry_artifact_id: "src-lst-beslut-v1",
    };
    const first = await land(base);
    const again = await land(base);
    expect(again.is_duplicate).toBe(true);
    expect(again.quarantine_id).toBe(first.quarantine_id);

    const otherUrl = await land({ ...base, source_url: "https://data.lansstyrelsen.se/wfs?req=other" });
    expect(otherUrl.is_duplicate).toBe(false);
    expect(otherUrl.quarantine_id).not.toBe(first.quarantine_id);
    const urlMeta = await storage.getMetadata(otherUrl.quarantine_id);
    expect(urlMeta && "source_url" in urlMeta ? urlMeta.source_url : "").toBe(
      "https://data.lansstyrelsen.se/wfs?req=other",
    );
    expect((await storage.getMetadata(first.quarantine_id))?.source_id).toBe("lst-beslut");
  });

  it("a partial temp file is not a successful manifest and is not promoted", async () => {
    const root = tempRoot();
    const storage = new DiskQuarantineStorage(root);
    const session = await storage.beginNetworkObservation({
      source_id: "lst-beslut",
      source_url: "https://data.lansstyrelsen.se/wfs?req=partial",
      file_name: "partial.bin",
    });
    await session.write(patternChunk(0, 32));
    expect(partialNames(root).every((name) => name.endsWith(".partial"))).toBe(true);
    expect(observationNames(root)).toEqual([]);
    await session.abort();
    expect(partialNames(root)).toEqual([]);
    expect(await storage.list()).toEqual([]);

    const promotionSurface = [
      new URL("../src/StreamingDownloadBody.ts", import.meta.url),
      new URL("../src/GovernedDownloadExecutor.ts", import.meta.url),
      new URL("../../mimers-brunn-core/src/governance/QuarantineStorage.ts", import.meta.url),
    ].map((file) => fs.readFileSync(file, "utf8"));
    for (const text of promotionSurface) {
      expect(text).not.toMatch(/FileCASRepository|QuarantinePromoter|postgis|PostGIS/);
    }
  });

  it("keeps redirect refusal on the streaming open path", async () => {
    const root = tempRoot();
    const start = "https://data.lansstyrelsen.se/a";
    const evil = "https://evil.example.com/b";
    const { transport, calls } = httpTransport(async (url) => {
      if (String(url) === start) {
        return new Response(null, { status: 302, headers: { location: evil } });
      }
      return chunkedResponse(CHUNK);
    });
    const { exec } = executorFor({
      def: source(),
      root,
      transport,
      targets: [{ url: start, file_name: "a.bin" }],
    });

    await expect(exec.execute(requestFor())).rejects.toThrow(/REJECT_REDIRECT_SCOPE/);
    expect(calls).toEqual([start]);
    expect(observationNames(root)).toEqual([]);
  });

  it("keeps credential scope on the streaming asset path", async () => {
    const root = tempRoot();
    let credentialReads = 0;
    const calls: string[] = [];
    const transport = new LantmaterietStacByggnaderAssetTransport({
      credentialProvider: {
        async getBearerToken() {
          credentialReads += 1;
          return TOKEN;
        },
      },
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        calls.push(String(url));
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
        return chunkedResponse(CHUNK);
      }) as typeof fetch,
    });
    transport.get = async () => {
      throw new Error("buffered get must not be used");
    };

    await expect(
      transport.open("https://dl1.lantmateriet.se/hydrografi/vatten_kn2482.zip", { timeout_ms: 1000 }),
    ).rejects.toThrow(/REJECT_AUTH_ASSET_SCOPE/);
    expect(credentialReads).toBe(0);

    const redirected = new LantmaterietStacByggnaderAssetTransport({
      credentialProvider: { async getBearerToken() { return TOKEN; } },
      fetchImpl: (async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/x.zip" } })) as typeof fetch,
    });
    await expect(redirected.open(ASSET_URL, { timeout_ms: 1000 })).rejects.toThrow(
      /REJECT_AUTHENTICATED_REDIRECT/,
    );

    const { exec, store } = executorFor({
      def: source({
        sourceId: "lm-byggnader",
        allowedDomains: ["dl1.lantmateriet.se"],
        adapter: "LM_STAC_BYGGNADER_V1",
      }),
      root,
      transport,
      targets: [{ url: ASSET_URL, file_name: "byggnad_kn2482.zip" }],
    });
    const ref = requireDownloadManifestRef(await exec.execute(requestFor("lm-byggnader")));
    const manifest = await store.resolve(ref);
    expect(calls).toEqual([ASSET_URL]);
    expect(manifest?.objects[0]?.byte_length).toBe(CHUNK);
    expect(manifest?.objects[0]?.url).toBe(ASSET_URL);
  });

  it("the streaming implementation does not allocate an object-sized buffer", () => {
    const streamingBody = fs.readFileSync(new URL("../src/StreamingDownloadBody.ts", import.meta.url), "utf8");
    const executor = fs.readFileSync(new URL("../src/GovernedDownloadExecutor.ts", import.meta.url), "utf8");
    const http = fs.readFileSync(new URL("../src/HttpDownloadTransport.ts", import.meta.url), "utf8");
    const asset = fs.readFileSync(
      new URL("../src/LantmaterietStacByggnaderAssetTransport.ts", import.meta.url),
      "utf8",
    );
    const quarantine = fs.readFileSync(
      new URL("../../mimers-brunn-core/src/governance/QuarantineStorage.ts", import.meta.url),
      "utf8",
    );
    const streamingExecutor = executor.slice(
      executor.indexOf("private async fetchOneStreaming"),
      executor.indexOf("private async fetchOneBuffered"),
    );
    const streamingOpen = http.slice(http.indexOf("async open("), http.indexOf("private async fetchStreaming"));
    const assetOpen = asset.slice(asset.indexOf("async open("), asset.indexOf("private async fetchStreaming"));
    const session = quarantine.slice(
      quarantine.indexOf("class DiskStreamingQuarantineSession"),
      quarantine.indexOf("async function hashFileIncremental"),
    );

    for (const text of [streamingBody, streamingExecutor, streamingOpen, assetOpen, session]) {
      expect(text).not.toMatch(/chunks\.push/);
      expect(text).not.toMatch(/Buffer\.concat/);
      expect(text).not.toMatch(/new Uint8Array\(\s*total/);
      expect(text).not.toMatch(/readFileSync/);
    }
    expect(streamingExecutor).not.toMatch(/response\.bytes/);
    expect(streamingOpen).not.toMatch(/readBounded/);
    expect(assetOpen).not.toMatch(/readBounded/);
  });

  it("aborts a stalled body on the idle timeout without treating that timeout as a total budget", async () => {
    const url = "https://data.lansstyrelsen.se/wfs?req=idle";
    const { transport } = httpTransport(async () => {
      let sent = false;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(new Uint8Array([1]));
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
          controller.enqueue(new Uint8Array([2]));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });

    const body = await transport.open(url, { timeout_ms: 150 });
    await expect(body.read()).resolves.toEqual(new Uint8Array([1]));
    await expect(body.read()).rejects.toThrow(/idle timeout/);
  });

  it("accepts continuous chunks whose total time exceeds the header timeout", async () => {
    const url = "https://data.lansstyrelsen.se/wfs?req=drip";
    const gapMs = 40;
    const count = 8;
    const { transport } = httpTransport(async () => delayedChunkResponse(count, gapMs));
    const started = Date.now();
    const body = await transport.open(url, { timeout_ms: 120, max_bytes: 100 });
    const landed: number[] = [];
    for (;;) {
      const chunk = await body.read();
      if (chunk === null) break;
      landed.push(...chunk);
    }
    expect(Date.now() - started).toBeGreaterThan(120);
    expect(landed).toEqual(Array.from({ length: count }, (_, index) => index + 1));
  });

  it(
    "does not abort a governed stream that keeps progressing past 30 seconds",
    async () => {
      const root = tempRoot();
      const url = "https://data.lansstyrelsen.se/wfs?req=slow";
      const gapMs = 5_000;
      const count = Math.ceil((STREAMING_HEADER_AND_IDLE_TIMEOUT_MS + gapMs) / gapMs);
      const { transport } = httpTransport(async () => delayedChunkResponse(count, gapMs));
      const { exec, store } = executorFor({
        def: source(),
        root,
        transport,
        targets: [{ url, file_name: "slow.bin" }],
      });
      const started = Date.now();
      const ref = requireDownloadManifestRef(await exec.execute(requestFor()));
      const elapsed = Date.now() - started;
      const manifest = await store.resolve(ref);
      expect(elapsed).toBeGreaterThan(STREAMING_HEADER_AND_IDLE_TIMEOUT_MS);
      expect(manifest?.objects[0]?.byte_length).toBe(count);
      expect(partialNames(root)).toEqual([]);
    },
    120_000,
  );
});

function delayedChunkResponse(count: number, gapMs: number): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      if (sent >= count) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(new Uint8Array([sent]));
    },
  });
  return new Response(stream, { status: 200 });
}
