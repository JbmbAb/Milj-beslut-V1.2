import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DiskQuarantineStorage,
  LocalPemSigningKeyProvider,
  type BeginNetworkObservationRequest,
  type QuarantinePutResult,
} from "@miljobeslut/mimers-brunn-core";

import { DownloadTargetResolverRegistry } from "../src/DownloadTargetResolvers";
import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import { GovernedDownloadExecutor } from "../src/GovernedDownloadExecutor";
import { requireDownloadManifestRef } from "../src/HarvestOrchestratorContracts";
import { HttpDownloadTransport } from "../src/HttpDownloadTransport";
import { LstIsoAtomZipTargetResolver } from "../src/LstIsoAtomZipResolver";
import {
  LST_DALARNA_PG304_ATOM_URL,
  LST_DALARNA_PG304_FILE_IDENTIFIER,
  LST_DALARNA_PG304_ISO_URL,
  LST_DALARNA_PG304_TERMS_REFERENCE,
  LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL,
  LST_DALARNA_PG304_ZIP_URL,
} from "../src/LstDalarnaPg304VattenskyddProposal";
import { approveSourceRegistryEntry } from "../src/SourceApproval";
import {
  isUrlAllowedForVerifiedSource,
  verifySourceRegistryArtifact,
  type VerifiedSourceDefinition,
  type VerifiedSourceRegistry,
} from "../src/SourceRegistry";

/**
 * L-V1-LST-ISO-ATOM-ZIP-02
 *
 * The adapter's ISO identity check must gate the accepted streaming quarantine.
 * Fixtures only. This does not approve the Länsstyrelsen source.
 */

const UPDATED = "2026-02-16T21:52:28";
const ZIP_CHUNKS = [new Uint8Array([0x50, 0x4b]), new Uint8Array([0x03, 0x04, 0x14])];
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]);
const ZIP_HASH = createHash("sha256").update(ZIP_BYTES).digest("hex");
const STALE_FILE_IDENTIFIER = "7423bc91-affe-4b4d-aaab-70435393d501";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class CountingQuarantine extends DiskQuarantineStorage {
  observations = 0;
  bufferedPuts = 0;

  override async beginNetworkObservation(request: BeginNetworkObservationRequest) {
    this.observations += 1;
    return super.beginNetworkObservation(request);
  }

  override async put(
    sourceId: string,
    sourceUrl: string,
    fileName: string,
    bytes: Uint8Array,
    customMetadata?: Record<string, any>,
  ): Promise<QuarantinePutResult> {
    this.bufferedPuts += 1;
    return super.put(sourceId, sourceUrl, fileName, bytes, customMetadata);
  }
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

function zipStreamResponse(): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = ZIP_CHUNKS[index];
      if (!chunk) {
        controller.close();
        return;
      }
      index += 1;
      controller.enqueue(chunk);
    },
  });
  return new Response(stream, { status: 200 });
}

async function signedSource(): Promise<VerifiedSourceDefinition> {
  const signing = LocalPemSigningKeyProvider.generate("ed25519:test-governor").provider;
  return verifySourceRegistryArtifact(
    await approveSourceRegistryEntry({
      entry: {
        ...LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL,
        policy: {
          ...LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL.policy,
          politeness_delay_ms: 0,
          rate_limit_requests_per_second: 0,
        },
      },
      approver_actor_id: "governor:test-only",
      signing,
    }),
    signing,
  );
}

function registryOf(source: VerifiedSourceDefinition): VerifiedSourceRegistry {
  return {
    registryPath: "<test>",
    sources: [source],
    getSource: (id) => (id === source.sourceId ? source : null),
    isUrlAllowedForSource: (id, url) =>
      id === source.sourceId ? isUrlAllowedForVerifiedSource(source, url) : false,
  };
}

function harness(source: VerifiedSourceDefinition, iso: string) {
  const calls: string[] = [];
  const root = mkdtempSync(join(tmpdir(), "loke-lst-stream-"));
  roots.push(root);
  const quarantine = new CountingQuarantine(root);
  const registry = registryOf(source);
  const transport = new HttpDownloadTransport({
    isUrlAllowed: (url) => isUrlAllowedForVerifiedSource(source, url),
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === LST_DALARNA_PG304_ISO_URL) return new Response(iso, { status: 200 });
      if (url === LST_DALARNA_PG304_ATOM_URL) return new Response(atomXml(), { status: 200 });
      if (url === LST_DALARNA_PG304_ZIP_URL) return zipStreamResponse();
      return new Response("absent", { status: 404 });
    }) as typeof fetch,
  });
  const executor = new GovernedDownloadExecutor(
    registry,
    new DownloadTargetResolverRegistry(registry, {
      [source.adapter]: new LstIsoAtomZipTargetResolver(transport),
    }),
    transport,
    quarantine,
    new InMemoryDownloadManifestStore(),
    { now: () => "2026-10-08T08:00:00.000Z" },
    async () => undefined,
  );
  return { calls, root, quarantine, executor };
}

describe("L-V1-LST-ISO-ATOM-ZIP-02 streaming quarantine", () => {
  it("streams the ZIP into a provenance-bound observation after the ISO identity matches", async () => {
    const source = await signedSource();
    const { calls, quarantine, executor } = harness(source, isoXml(LST_DALARNA_PG304_FILE_IDENTIFIER));

    const outcome = await executor.execute({
      dataset_ref: {
        id: source.sourceId,
        content_hash: { algorithm: "sha256", digest: source.sourceContentHash },
      },
      execution_id: "exec-lst-stream",
      requested_at: "2026-10-08T08:00:00.000Z",
    });

    expect(requireDownloadManifestRef(outcome).content_hash.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(calls).toEqual([
      LST_DALARNA_PG304_ISO_URL,
      LST_DALARNA_PG304_ATOM_URL,
      LST_DALARNA_PG304_ZIP_URL,
    ]);
    expect(quarantine.observations).toBe(1);
    expect(quarantine.bufferedPuts).toBe(0);

    const listed = await quarantine.list();
    expect(listed).toHaveLength(1);
    const landed = listed[0];
    expect(landed?.source_id).toBe(source.sourceId);
    expect(landed && "source_url" in landed ? landed.source_url : "").toBe(LST_DALARNA_PG304_ZIP_URL);
    expect(landed?.file_name).toBe("Lstw.PG304_Vattenskyddsomraden_lokala_foreskrifter.zip");
    expect(landed?.content_hash).toBe(ZIP_HASH);
    expect(landed?.status).toBe("quarantined");
    expect(landed?.custom_metadata).toMatchObject({
      registry_artifact_id: source.registryArtifactId,
      source_metadata: {
        iso_file_identifier: LST_DALARNA_PG304_FILE_IDENTIFIER,
        terms_reference: LST_DALARNA_PG304_TERMS_REFERENCE,
        atom_updated: UPDATED,
        atom_entry_locator: LST_DALARNA_PG304_ZIP_URL,
      },
    });
    expect(landed ? await quarantine.get(landed.quarantine_id) : null).toEqual(ZIP_BYTES);
  });

  it("rejects a stale ISO fileIdentifier before ATOM, ZIP, or quarantine", async () => {
    const source = await signedSource();
    const { calls, root, quarantine, executor } = harness(source, isoXml(STALE_FILE_IDENTIFIER));

    await expect(executor.execute({
      dataset_ref: {
        id: source.sourceId,
        content_hash: { algorithm: "sha256", digest: source.sourceContentHash },
      },
      execution_id: "exec-lst-stale",
      requested_at: "2026-10-08T08:00:00.000Z",
    })).rejects.toMatchObject({ reason_code: "REJECT_DISTRIBUTION_IDENTITY" });

    expect(calls).toEqual([LST_DALARNA_PG304_ISO_URL]);
    expect(quarantine.observations).toBe(0);
    expect(quarantine.bufferedPuts).toBe(0);
    expect(await quarantine.list()).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });
});
