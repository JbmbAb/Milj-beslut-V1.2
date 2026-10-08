import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DiskQuarantineStorage,
  LocalPemVerificationKeyProvider,
  type BeginNetworkObservationRequest,
} from "@miljobeslut/mimers-brunn-core";

import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import { PRODUCTION_ADAPTER_RESOLVERS, composeHarvestRuntime } from "../src/HarvestRuntimeCompositionRoot";
import { requireDownloadManifestRef } from "../src/HarvestOrchestratorContracts";
import { LstIsoAtomZipTargetResolver } from "../src/LstIsoAtomZipResolver";
import {
  LST_DALARNA_PG304_ATOM_URL,
  LST_DALARNA_PG304_FILE_IDENTIFIER,
  LST_DALARNA_PG304_ISO_URL,
  LST_DALARNA_PG304_TERMS_REFERENCE,
  LST_DALARNA_PG304_ZIP_URL,
} from "../src/LstDalarnaPg304VattenskyddProposal";
import {
  loadVerifiedSourceRegistry,
  type VerifiedSourceDefinition,
} from "../src/SourceRegistry";

/**
 * L-V1-LST-RUNTIME-PROOF-01
 *
 * Isolated fixture proof against the admitted registry entry. No live upstream,
 * no production adapter registration, no CAS promotion.
 */

const ADMISSION_COMMIT = "dcec9ebf2989afc2650a9c1e882cdf273c92355c";
const ADMISSION_REGISTRY_SHA256 = "d2c1ebf3705047f3e099b689db6c38e69945dd7d67d35fc28a9a95e5cb3562d9";
const SOURCE_ID = "lansstyrelsen-dalarna-pg304-vattenskydd-kommunala";
const ARTIFACT_ID = "reg-lst-w-pg304-vattenskydd-v1";
const CONTENT_HASH = "0ce90fe6dcd144e2ea1466ff3a8563e04936c3c871129a0426d83da1722a52f5";
const SIGNATURE = "ed25519:9TXy/1+izI1w82jQGPx1OMYM+EM9XJKPF+/EtGPBOpgYOFl0wZQ+e2JJqsQMmesT9nyFUPor44SlujeluiDfDw==";
const UPDATED = "2026-02-16T21:52:28";
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]);
const ZIP_HASH = createHash("sha256").update(ZIP_BYTES).digest("hex");
const OFF_SCOPE = "https://evil.example/not-a-distribution.zip";
const PUBLIC_KEY = join(
  process.env.USERPROFILE ?? "",
  ".mimers",
  "secrets",
  "source-registry-governor-signing-key-v1",
  "public.pem",
);
const NATIONAL_REGISTRY = resolve(__dirname, "../../..", "source-registry", "national-registry.json");

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "loke-lst-runtime-proof-"));
  roots.push(root);
  return root;
}

function sha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function admittedObjectText(national: string): string {
  const needle = `  {\n    "artifact_id": "${ARTIFACT_ID}"`;
  const start = national.indexOf(needle);
  if (start < 0) throw new Error("ADMISSION_ENTRY_MISSING");
  const open = start + 2;
  let depth = 0;
  for (let i = open; i < national.length; i += 1) {
    const char = national[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return national.slice(start, i + 1);
    }
  }
  throw new Error("ADMISSION_ENTRY_UNCLOSED");
}

function isoXml(fileIdentifier: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gmd:MD_Metadata xmlns:gmd="http://www.isotc211.org/2005/gmd" xmlns:gco="http://www.isotc211.org/2005/gco" xmlns:gmx="http://www.isotc211.org/2005/gmx" xmlns:xlink="http://www.w3.org/1999/xlink">
  <gmd:fileIdentifier><gco:CharacterString>${fileIdentifier}</gco:CharacterString></gmd:fileIdentifier>
  <gmd:identificationInfo><gmd:MD_DataIdentification>
    <gmd:resourceConstraints><gmd:MD_LegalConstraints>
      <gmd:useConstraints><gmd:MD_RestrictionCode>otherRestrictions</gmd:MD_RestrictionCode></gmd:useConstraints>
      <gmd:otherConstraints><gmx:Anchor xlink:href="${LST_DALARNA_PG304_TERMS_REFERENCE}">inga tillämpliga villkor</gmx:Anchor></gmd:otherConstraints>
    </gmd:MD_LegalConstraints></gmd:resourceConstraints>
  </gmd:MD_DataIdentification></gmd:identificationInfo>
  <gmd:distributionInfo><gmd:MD_Distribution><gmd:transferOptions><gmd:MD_DigitalTransferOptions>
    <gmd:onLine><gmd:CI_OnlineResource>
      <gmd:linkage><gmd:URL>${LST_DALARNA_PG304_ATOM_URL}</gmd:URL></gmd:linkage>
      <gmd:protocol><gco:CharacterString>HTTP:Nedladdning:Atom</gco:CharacterString></gmd:protocol>
    </gmd:CI_OnlineResource></gmd:onLine>
  </gmd:MD_DigitalTransferOptions></gmd:transferOptions></gmd:MD_Distribution></gmd:distributionInfo>
</gmd:MD_Metadata>`;
}

function atomXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <rights>NOT-A-LICENSE</rights>
  <entry>
    <id>${LST_DALARNA_PG304_ZIP_URL}</id>
    <link href="${LST_DALARNA_PG304_ZIP_URL}" rel="alternate" type="application/zip"></link>
    <updated>${UPDATED}</updated>
  </entry>
</feed>`;
}

function zipResponse(body: Uint8Array, headers?: Record<string, string>): Response {
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.close();
        return;
      }
      sent = true;
      controller.enqueue(body);
    },
  });
  return new Response(stream, { status: 200, headers });
}

function authority() {
  const nationalBytes = readFileSync(NATIONAL_REGISTRY);
  expect(sha256(nationalBytes)).toBe(ADMISSION_REGISTRY_SHA256);
  const national = nationalBytes.toString("utf8");
  const inner = admittedObjectText(national);
  const root = tempRoot();
  const registryPath = join(root, "sole-registry.json");
  writeFileSync(registryPath, `[\n${inner}\n]\n`);
  const signing = new LocalPemVerificationKeyProvider(
    "ed25519:source-registry-governor-2026-08-25",
    readFileSync(PUBLIC_KEY, "utf8"),
  );
  expect("sign" in signing).toBe(false);
  return { registryPath, signing, national };
}

async function admittedSource(): Promise<{
  registryPath: string;
  signing: LocalPemVerificationKeyProvider;
  source: VerifiedSourceDefinition;
}> {
  const { registryPath, signing } = authority();
  const registry = await loadVerifiedSourceRegistry({ registryPath, signing });
  expect(registry.sources).toHaveLength(1);
  const source = registry.getSource(SOURCE_ID);
  if (!source) throw new Error("ADMITTED_SOURCE_MISSING");
  expect(source.registryArtifactId).toBe(ARTIFACT_ID);
  expect(source.sourceContentHash).toBe(CONTENT_HASH);
  expect(source.adapter).toBe("LST_ISO_ATOM_ZIP_V1");
  expect(source.distributionBinding).toEqual({
    kind: "iso-19115-file-identifier",
    value: LST_DALARNA_PG304_FILE_IDENTIFIER,
  });
  return { registryPath, signing, source };
}

function requestFor(source: VerifiedSourceDefinition, executionId: string) {
  return {
    dataset_ref: {
      id: source.sourceId,
      content_hash: { algorithm: "sha256" as const, digest: source.sourceContentHash },
    },
    execution_id: executionId,
    requested_at: "2026-10-08T16:00:00.000Z",
  };
}

describe("L-V1-LST-RUNTIME-PROOF-01", () => {
  it("keeps the V1 adapter out of production composition and refuses it there", async () => {
    expect(ADMISSION_COMMIT).toHaveLength(40);
    expect(Object.keys(PRODUCTION_ADAPTER_RESOLVERS).sort()).toEqual([
      "LM_STAC_BYGGNADER_V1",
      "PUH_RATTSPRAXIS_V1",
      "SINGLE_ENDPOINT_V1",
    ]);
    expect(PRODUCTION_ADAPTER_RESOLVERS).not.toHaveProperty("LST_ISO_ATOM_ZIP_V1");

    const calls: string[] = [];
    const { registryPath, signing, source } = await admittedSource();
    const runtime = await composeHarvestRuntime({
      registryPath,
      signing,
      quarantine: new DiskQuarantineStorage(tempRoot()),
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      clock: { now: () => "2026-10-08T16:00:00.000Z" },
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        throw new Error("PRODUCTION_COMPOSITION_MUST_NOT_FETCH");
      }) as typeof fetch,
    });

    await expect(runtime.executor.execute(requestFor(source, "exec-production-adapter-absent")))
      .rejects.toMatchObject({ reason_code: "REJECT_ADAPTER" });
    expect(calls).toEqual([]);
    expect(runtime.registry.sources.map((entry) => entry.sourceId)).toEqual([SOURCE_ID]);
  });

  it("runs the admitted entry through registry, binding, fixture HTTP, streaming, and quarantine", async () => {
    const calls: string[] = [];
    const { registryPath, signing, source } = await admittedSource();
    const quarantineRoot = tempRoot();
    const manifests = new InMemoryDownloadManifestStore();
    const persisted: string[] = [];
    const persist = manifests.persist.bind(manifests);
    manifests.persist = async (manifest) => {
      persisted.push(manifest.source_id);
      return persist(manifest);
    };
    const runtime = await composeHarvestRuntime({
      registryPath,
      signing,
      quarantine: new DiskQuarantineStorage(quarantineRoot),
      downloadManifestStore: manifests,
      clock: { now: () => "2026-10-08T16:00:00.000Z" },
      adapters: {
        LST_ISO_ATOM_ZIP_V1: (transport) => new LstIsoAtomZipTargetResolver(transport),
      },
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url === LST_DALARNA_PG304_ISO_URL) return new Response(isoXml(LST_DALARNA_PG304_FILE_IDENTIFIER), { status: 200 });
        if (url === LST_DALARNA_PG304_ATOM_URL) return new Response(atomXml(), { status: 200 });
        if (url === LST_DALARNA_PG304_ZIP_URL) return zipResponse(ZIP_BYTES);
        throw new Error(`UNEXPECTED_URL ${url}`);
      }) as typeof fetch,
    });

    const outcome = await runtime.executor.execute(requestFor(source, "exec-runtime-proof"));
    const ref = requireDownloadManifestRef(outcome);
    const manifest = await manifests.resolve(ref);
    expect(manifest?.source_content_hash).toBe(CONTENT_HASH);
    expect(manifest?.registry_artifact_id).toBe(ARTIFACT_ID);
    expect(manifest?.objects).toHaveLength(1);
    expect(manifest?.objects[0]).toMatchObject({
      url: LST_DALARNA_PG304_ZIP_URL,
      content_hash: ZIP_HASH,
      byte_length: ZIP_BYTES.byteLength,
      source_metadata: {
        iso_file_identifier: LST_DALARNA_PG304_FILE_IDENTIFIER,
        terms_reference: LST_DALARNA_PG304_TERMS_REFERENCE,
        atom_updated: UPDATED,
        atom_entry_locator: LST_DALARNA_PG304_ZIP_URL,
      },
    });
    expect(calls).toEqual([
      LST_DALARNA_PG304_ISO_URL,
      LST_DALARNA_PG304_ATOM_URL,
      LST_DALARNA_PG304_ZIP_URL,
    ]);
    expect(persisted).toEqual([SOURCE_ID]);

    const quarantine = new DiskQuarantineStorage(quarantineRoot);
    const listed = await quarantine.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      source_id: SOURCE_ID,
      content_hash: ZIP_HASH,
      status: "quarantined",
      custom_metadata: { registry_artifact_id: ARTIFACT_ID },
    });
    expect(listed[0] ? await quarantine.get(listed[0].quarantine_id) : null).toEqual(ZIP_BYTES);
    expect(sha256(readFileSync(NATIONAL_REGISTRY))).toBe(ADMISSION_REGISTRY_SHA256);
  }, 20_000);

  it("rejects a divergent ISO identity before ATOM, ZIP, or quarantine", async () => {
    const calls: string[] = [];
    const { registryPath, signing, source } = await admittedSource();
    const quarantineRoot = tempRoot();
    const runtime = await composeHarvestRuntime({
      registryPath,
      signing,
      quarantine: new DiskQuarantineStorage(quarantineRoot),
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      clock: { now: () => "2026-10-08T16:00:00.000Z" },
      adapters: {
        LST_ISO_ATOM_ZIP_V1: (transport) => new LstIsoAtomZipTargetResolver(transport),
      },
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url === LST_DALARNA_PG304_ISO_URL) {
          return new Response(isoXml("7423bc91-affe-4b4d-aaab-70435393d501"), { status: 200 });
        }
        throw new Error(`UNEXPECTED_URL ${url}`);
      }) as typeof fetch,
    });

    await expect(runtime.executor.execute(requestFor(source, "exec-divergent")))
      .rejects.toMatchObject({ reason_code: "REJECT_DISTRIBUTION_IDENTITY" });
    expect(calls).toEqual([LST_DALARNA_PG304_ISO_URL]);
    expect(readdirSync(quarantineRoot)).toEqual([]);
  });

  it("rejects an off-scope redirect and does not fetch the redirected URL", async () => {
    const calls: string[] = [];
    const { registryPath, signing, source } = await admittedSource();
    const quarantineRoot = tempRoot();
    const runtime = await composeHarvestRuntime({
      registryPath,
      signing,
      quarantine: new DiskQuarantineStorage(quarantineRoot),
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      clock: { now: () => "2026-10-08T16:00:00.000Z" },
      adapters: {
        LST_ISO_ATOM_ZIP_V1: (transport) => new LstIsoAtomZipTargetResolver(transport),
      },
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url === OFF_SCOPE) throw new Error("OFF_SCOPE_FETCH");
        if (url === LST_DALARNA_PG304_ISO_URL) return new Response(isoXml(LST_DALARNA_PG304_FILE_IDENTIFIER), { status: 200 });
        if (url === LST_DALARNA_PG304_ATOM_URL) return new Response(atomXml(), { status: 200 });
        if (url === LST_DALARNA_PG304_ZIP_URL) {
          return new Response(null, { status: 302, headers: { location: OFF_SCOPE } });
        }
        throw new Error(`UNEXPECTED_URL ${url}`);
      }) as typeof fetch,
    });

    await expect(runtime.executor.execute(requestFor(source, "exec-redirect")))
      .rejects.toMatchObject({ reason_code: "REJECT_REDIRECT_SCOPE" });
    expect(calls).not.toContain(OFF_SCOPE);
    expect(await new DiskQuarantineStorage(quarantineRoot).list()).toEqual([]);
  }, 20_000);

  it("does not finalize quarantine or a manifest when the ZIP transfer breaks", async () => {
    const { registryPath, signing, source } = await admittedSource();
    const quarantineRoot = tempRoot();
    const manifests = new InMemoryDownloadManifestStore();
    let persists = 0;
    const persist = manifests.persist.bind(manifests);
    manifests.persist = async (manifest) => {
      persists += 1;
      return persist(manifest);
    };
    const runtime = await composeHarvestRuntime({
      registryPath,
      signing,
      quarantine: new DiskQuarantineStorage(quarantineRoot),
      downloadManifestStore: manifests,
      clock: { now: () => "2026-10-08T16:00:00.000Z" },
      adapters: {
        LST_ISO_ATOM_ZIP_V1: (transport) => new LstIsoAtomZipTargetResolver(transport),
      },
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === LST_DALARNA_PG304_ISO_URL) return new Response(isoXml(LST_DALARNA_PG304_FILE_IDENTIFIER), { status: 200 });
        if (url === LST_DALARNA_PG304_ATOM_URL) return new Response(atomXml(), { status: 200 });
        if (url === LST_DALARNA_PG304_ZIP_URL) {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
              controller.error(new Error("connection reset"));
            },
          });
          return new Response(stream, { status: 200, headers: { "content-length": "128" } });
        }
        throw new Error(`UNEXPECTED_URL ${url}`);
      }) as typeof fetch,
    });

    await expect(runtime.executor.execute(requestFor(source, "exec-interrupted")))
      .rejects.toMatchObject({ reason_code: "REJECT_RETRIES_EXHAUSTED" });
    expect(persists).toBe(0);
    expect(await new DiskQuarantineStorage(quarantineRoot).list()).toEqual([]);
  }, 30_000);

  it("rejects a quarantine hash that does not match the streamed bytes and stores no manifest", async () => {
    const { registryPath, signing, source } = await admittedSource();
    const quarantineRoot = tempRoot();
    const real = new DiskQuarantineStorage(quarantineRoot);
    const lying = new DiskQuarantineStorage(quarantineRoot);
    lying.beginNetworkObservation = async (request: BeginNetworkObservationRequest) => {
      const inner = await real.beginNetworkObservation(request);
      return {
        write: (chunk: Uint8Array) => inner.write(chunk),
        abort: () => inner.abort(),
        async finalize(witness) {
          const landed = await inner.finalize(witness);
          return { ...landed, hash: "e".repeat(64) };
        },
      };
    };
    const manifests = new InMemoryDownloadManifestStore();
    let persists = 0;
    const persist = manifests.persist.bind(manifests);
    manifests.persist = async (manifest) => {
      persists += 1;
      return persist(manifest);
    };
    const runtime = await composeHarvestRuntime({
      registryPath,
      signing,
      quarantine: lying,
      downloadManifestStore: manifests,
      clock: { now: () => "2026-10-08T16:00:00.000Z" },
      adapters: {
        LST_ISO_ATOM_ZIP_V1: (transport) => new LstIsoAtomZipTargetResolver(transport),
      },
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === LST_DALARNA_PG304_ISO_URL) return new Response(isoXml(LST_DALARNA_PG304_FILE_IDENTIFIER), { status: 200 });
        if (url === LST_DALARNA_PG304_ATOM_URL) return new Response(atomXml(), { status: 200 });
        if (url === LST_DALARNA_PG304_ZIP_URL) return zipResponse(ZIP_BYTES);
        throw new Error(`UNEXPECTED_URL ${url}`);
      }) as typeof fetch,
    });

    await expect(runtime.executor.execute(requestFor(source, "exec-checksum")))
      .rejects.toMatchObject({ reason_code: "REJECT_CHECKSUM" });
    expect(persists).toBe(0);
    const listed = await real.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.content_hash).toBe(ZIP_HASH);
    expect(listed[0]?.content_hash).not.toBe("e".repeat(64));
  }, 20_000);

  it("stores a fully transferred short body by its byte hash and does not parse ZIP structure", async () => {
    const short = new Uint8Array([0x50, 0x4b]);
    const { registryPath, signing, source } = await admittedSource();
    const quarantineRoot = tempRoot();
    const manifests = new InMemoryDownloadManifestStore();
    const runtime = await composeHarvestRuntime({
      registryPath,
      signing,
      quarantine: new DiskQuarantineStorage(quarantineRoot),
      downloadManifestStore: manifests,
      clock: { now: () => "2026-10-08T16:00:00.000Z" },
      adapters: {
        LST_ISO_ATOM_ZIP_V1: (transport) => new LstIsoAtomZipTargetResolver(transport),
      },
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === LST_DALARNA_PG304_ISO_URL) return new Response(isoXml(LST_DALARNA_PG304_FILE_IDENTIFIER), { status: 200 });
        if (url === LST_DALARNA_PG304_ATOM_URL) return new Response(atomXml(), { status: 200 });
        if (url === LST_DALARNA_PG304_ZIP_URL) {
          return zipResponse(short, { "content-length": "128" });
        }
        throw new Error(`UNEXPECTED_URL ${url}`);
      }) as typeof fetch,
    });

    const outcome = await runtime.executor.execute(requestFor(source, "exec-short-zip"));
    const manifest = await manifests.resolve(requireDownloadManifestRef(outcome));
    expect(manifest?.objects[0]).toMatchObject({
      byte_length: short.byteLength,
      content_hash: createHash("sha256").update(short).digest("hex"),
    });
    const listed = await new DiskQuarantineStorage(quarantineRoot).list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.content_hash).toBe(createHash("sha256").update(short).digest("hex"));
    expect(listed[0] ? await new DiskQuarantineStorage(quarantineRoot).get(listed[0].quarantine_id) : null).toEqual(short);
  }, 20_000);

  it("records the admitted signature that the sole registry verified", async () => {
    const { national } = authority();
    const parsed = JSON.parse(national) as Array<{
      artifact_id: string;
      approval_attestation?: { signature?: string; subjectDigest?: string };
    }>;
    const entry = parsed.find((item) => item.artifact_id === ARTIFACT_ID);
    expect(parsed).toHaveLength(14);
    expect(entry?.approval_attestation?.signature).toBe(SIGNATURE);
    expect(entry?.approval_attestation?.subjectDigest).toBe(`sha256:${CONTENT_HASH}`);
  });
});
