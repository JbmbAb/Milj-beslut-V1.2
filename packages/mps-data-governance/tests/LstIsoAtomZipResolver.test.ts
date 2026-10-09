import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { LocalPemSigningKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { QuarantineStorage, RawSourceArtifact } from "@miljobeslut/mimers-brunn-core";

import { DownloadTargetResolverRegistry } from "../src/DownloadTargetResolvers";
import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import { GovernedDownloadError, type DownloadTransport } from "../src/GovernedDownloadContracts";
import { GovernedDownloadExecutor } from "../src/GovernedDownloadExecutor";
import { requireDownloadManifestRef } from "../src/HarvestOrchestratorContracts";
import { PRODUCTION_ADAPTER_RESOLVERS } from "../src/HarvestRuntimeCompositionRoot";
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
  calculateSourceRegistryContentHash,
  isUrlAllowedForVerifiedSource,
  sourceRegistryArtifactForHash,
  verifySourceRegistryArtifact,
  type SourceRegistryArtifact,
  type VerifiedSourceDefinition,
  type VerifiedSourceRegistry,
} from "../src/SourceRegistry";

const UPDATED = "2026-02-16T21:52:28";
const RESOURCE_IDENTIFIER = "112149a2-f43a-4b7e-bac9-68c9318e8891";
const STALE_METADATA_URL =
  "https://ext-geodatakatalog.lansstyrelsen.se/GeodataKatalogen/GetMetaDataById?id=7423bc91-affe-4b4d-aaab-70435393d501&format=ISO_19139";
const DECOY_WMS = "https://ext-geodata-lokala-visning.lansstyrelsen.se/arcgis/services/LSTW/wms";
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]);
const ACCESS_ANCHOR = "https://resources.geodata.se/codelist/metadata/atkomstrestriktioner.xml#InnehallerPersonUppgifter";

function isoXml(fileIdentifier = LST_DALARNA_PG304_FILE_IDENTIFIER, atomUrl = LST_DALARNA_PG304_ATOM_URL): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gmd:MD_Metadata xmlns:gmd="http://www.isotc211.org/2005/gmd" xmlns:gco="http://www.isotc211.org/2005/gco" xmlns:gmx="http://www.isotc211.org/2005/gmx" xmlns:xlink="http://www.w3.org/1999/xlink">
  <gmd:fileIdentifier><gco:CharacterString>${fileIdentifier}</gco:CharacterString></gmd:fileIdentifier>
  <gmd:identificationInfo>
    <gmd:MD_DataIdentification>
      <gmd:citation>
        <gmd:CI_Citation>
          <gmd:identifier>
            <gmd:MD_Identifier><gmd:code><gco:CharacterString>${RESOURCE_IDENTIFIER}</gco:CharacterString></gmd:code></gmd:MD_Identifier>
          </gmd:identifier>
        </gmd:CI_Citation>
      </gmd:citation>
      <gmd:resourceConstraints>
        <gmd:MD_LegalConstraints>
          <gmd:accessConstraints><gmd:MD_RestrictionCode>otherRestrictions</gmd:MD_RestrictionCode></gmd:accessConstraints>
          <gmd:otherConstraints><gmx:Anchor xlink:href="${ACCESS_ANCHOR}">Innehåller personuppgifter</gmx:Anchor></gmd:otherConstraints>
        </gmd:MD_LegalConstraints>
      </gmd:resourceConstraints>
      <gmd:resourceConstraints>
        <gmd:MD_LegalConstraints>
          <gmd:useConstraints><gmd:MD_RestrictionCode>otherRestrictions</gmd:MD_RestrictionCode></gmd:useConstraints>
          <gmd:otherConstraints><gmx:Anchor xlink:href="${LST_DALARNA_PG304_TERMS_REFERENCE}">inga tillämpliga villkor</gmx:Anchor></gmd:otherConstraints>
        </gmd:MD_LegalConstraints>
      </gmd:resourceConstraints>
    </gmd:MD_DataIdentification>
  </gmd:identificationInfo>
  <gmd:distributionInfo>
    <gmd:MD_Distribution>
      <gmd:transferOptions>
        <gmd:MD_DigitalTransferOptions>
          <gmd:onLine>
            <gmd:CI_OnlineResource>
              <gmd:linkage><gmd:URL>${DECOY_WMS}</gmd:URL></gmd:linkage>
              <gmd:protocol><gco:CharacterString>HTTP:OGC:WMS</gco:CharacterString></gmd:protocol>
            </gmd:CI_OnlineResource>
          </gmd:onLine>
          <gmd:onLine>
            <gmd:CI_OnlineResource>
              <gmd:linkage><gmd:URL>${atomUrl}</gmd:URL></gmd:linkage>
              <gmd:protocol><gco:CharacterString>HTTP:Nedladdning:Atom</gco:CharacterString></gmd:protocol>
              <gmd:name><gco:CharacterString>Atom-fil</gco:CharacterString></gmd:name>
            </gmd:CI_OnlineResource>
          </gmd:onLine>
        </gmd:MD_DigitalTransferOptions>
      </gmd:transferOptions>
    </gmd:MD_Distribution>
  </gmd:distributionInfo>
</gmd:MD_Metadata>`;
}

function atomXml(zipUrl = LST_DALARNA_PG304_ZIP_URL): string {
  const stale = STALE_METADATA_URL.replace(/&/g, "&amp;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <rights>NOT-A-LICENSE</rights>
  <entry>
    <content type="html">Metadata:&lt;a href="${stale}"&gt;old&lt;/a&gt;</content>
    <id>${zipUrl}</id>
    <link href="${zipUrl}" rel="alternate" type="application/zip"></link>
    <updated>${UPDATED}</updated>
  </entry>
</feed>`;
}

function scripted(
  pages: Readonly<Record<string, Uint8Array | string>>,
  allowed: (url: string) => boolean,
): DownloadTransport & { readonly calls: readonly string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      if (!allowed(url)) {
        throw new GovernedDownloadError(
          `REJECT_URL_SCOPE: '${url}' is outside the approved scope.`,
          "REJECT_URL_SCOPE",
        );
      }
      const body = pages[url];
      if (body === undefined) return { status: 404, bytes: new Uint8Array(), headers: {}, finalUrl: url };
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
      return { status: 200, bytes, headers: {}, finalUrl: url };
    },
  };
}

function registryOf(source: VerifiedSourceDefinition): VerifiedSourceRegistry {
  return {
    registryPath: "<test>",
    sources: [source],
    getSource: (id) => (id === source.sourceId ? source : null),
    isUrlAllowedForSource: (id, url) => id === source.sourceId && isUrlAllowedForVerifiedSource(source, url),
  };
}

async function signedProposal(): Promise<VerifiedSourceDefinition> {
  const signing = LocalPemSigningKeyProvider.generate("ed25519:test-governor").provider;
  const entry = {
    ...LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL,
    policy: {
      ...LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL.policy,
      politeness_delay_ms: 0,
      rate_limit_requests_per_second: 0,
    },
  };
  return verifySourceRegistryArtifact(
    await approveSourceRegistryEntry({
      entry,
      approver_actor_id: "governor:test-only",
      signing,
    }),
    signing,
  );
}

describe("L-V1-LST-ISO-ATOM-ZIP-01", () => {
  it("keeps the in-code proposal unsigned while the registry holds the signed V1 entry", () => {
    expect(LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL.lifecycle_state).toBe("REGISTERED");
    expect(LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL).not.toHaveProperty("approval_attestation");
    expect(LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL.distribution_binding).toEqual({
      kind: "iso-19115-file-identifier",
      value: "7423bc91-affe-4b4d-aaab-70435393d501_C",
    });
    const channel = LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL.channel;
    if (channel.channel_type === "ARCHIVE_IMPORT") {
      throw new Error("the Dalarna proposal is a network catalogue source");
    }
    expect(channel.endpoint_url).toBe(LST_DALARNA_PG304_ISO_URL);
    expect(channel.allowed_domains).toEqual([
      "ext-geodatakatalog-forv.lansstyrelsen.se",
      "ext-dokument.lansstyrelsen.se",
    ]);
    expect(LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL.adapter).toBe("LST_ISO_ATOM_ZIP_V1");
    expect(PRODUCTION_ADAPTER_RESOLVERS).toHaveProperty("LST_ISO_ATOM_ZIP_V1");
    expect(PRODUCTION_ADAPTER_RESOLVERS).not.toHaveProperty("LST_ATOM_ZIP_V1");

    const national = JSON.parse(readFileSync(
      resolve(__dirname, "../../..", "source-registry", "national-registry.json"),
      "utf8",
    )) as SourceRegistryArtifact[];
    const admitted = national.filter(
      (entry) => entry.source_id === LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL.source_id,
    );
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toMatchObject({
      artifact_id: "reg-lst-w-pg304-vattenskydd-v1",
      lifecycle_state: "APPROVED",
      adapter: "LST_ISO_ATOM_ZIP_V1",
      distribution_binding: LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL.distribution_binding,
      approval_attestation: {
        subjectDigest: "sha256:0ce90fe6dcd144e2ea1466ff3a8563e04936c3c871129a0426d83da1722a52f5",
        signer: "ed25519:source-registry-governor-2026-08-25",
        predicate: {
          approver_actor_id: "bjb@miljöbeslut.se",
          source_content_hash: "0ce90fe6dcd144e2ea1466ff3a8563e04936c3c871129a0426d83da1722a52f5",
        },
      },
    });
    expect(() => calculateSourceRegistryContentHash(
      sourceRegistryArtifactForHash(LST_DALARNA_PG304_VATTENSKYDD_PROPOSAL as SourceRegistryArtifact),
    )).not.toThrow();
  });

  it("starts at the signed ISO record and does not follow the stale ATOM metadata href", async () => {
    const source = await signedProposal();
    const transport = scripted({
      [LST_DALARNA_PG304_ISO_URL]: isoXml(),
      [LST_DALARNA_PG304_ATOM_URL]: atomXml(),
    }, (url) => isUrlAllowedForVerifiedSource(source, url));

    const plan = await new DownloadTargetResolverRegistry(registryOf(source), {
      [source.adapter]: new LstIsoAtomZipTargetResolver(transport),
    }).resolve({ source_id: source.sourceId, execution_id: "exec-1" });

    expect(plan.kind).toBe("TARGETS");
    if (plan.kind !== "TARGETS") return;
    expect(plan.targets).toEqual([{
      url: LST_DALARNA_PG304_ZIP_URL,
      file_name: "Lstw.PG304_Vattenskyddsomraden_lokala_foreskrifter.zip",
      source_metadata: {
        iso_file_identifier: LST_DALARNA_PG304_FILE_IDENTIFIER,
        terms_reference: LST_DALARNA_PG304_TERMS_REFERENCE,
        atom_updated: UPDATED,
        atom_entry_locator: LST_DALARNA_PG304_ZIP_URL,
      },
      targetIdentity: `${LST_DALARNA_PG304_ZIP_URL}\nLstw.PG304_Vattenskyddsomraden_lokala_foreskrifter.zip`,
      strongEtagAuthority: null,
    }]);
    expect(JSON.stringify(plan.targets[0]?.source_metadata)).not.toContain("NOT-A-LICENSE");
    expect(JSON.stringify(plan.targets[0]?.source_metadata)).not.toContain(ACCESS_ANCHOR);
    expect(JSON.stringify(plan.targets[0]?.source_metadata)).not.toContain(RESOURCE_IDENTIFIER);
    expect(transport.calls).toEqual([LST_DALARNA_PG304_ISO_URL, LST_DALARNA_PG304_ATOM_URL]);
    expect(transport.calls).not.toContain(STALE_METADATA_URL);
    expect(transport.calls).not.toContain(DECOY_WMS);
  });

  it("stops before ATOM when the ISO fileIdentifier is not the signed value", async () => {
    const source = await signedProposal();
    const transport = scripted({
      [LST_DALARNA_PG304_ISO_URL]: isoXml("7423bc91-affe-4b4d-aaab-70435393d501"),
      [LST_DALARNA_PG304_ATOM_URL]: atomXml(),
    }, (url) => isUrlAllowedForVerifiedSource(source, url));

    await expect(new LstIsoAtomZipTargetResolver(transport).resolve(source, "exec-1")).rejects.toMatchObject({
      reason_code: "REJECT_DISTRIBUTION_IDENTITY",
    });
    expect(transport.calls).toEqual([LST_DALARNA_PG304_ISO_URL]);
  });

  it("fails closed when the ATOM feed is not exactly one ZIP", async () => {
    const source = await signedProposal();
    const twoZips = atomXml().replace(
      "</entry>",
      '<link href="https://ext-dokument.lansstyrelsen.se/other.zip" type="application/zip"></link></entry>',
    );
    const transport = scripted({
      [LST_DALARNA_PG304_ISO_URL]: isoXml(),
      [LST_DALARNA_PG304_ATOM_URL]: twoZips,
    }, (url) => isUrlAllowedForVerifiedSource(source, url));

    await expect(new LstIsoAtomZipTargetResolver(transport).resolve(source, "exec-1")).rejects.toMatchObject({
      reason_code: "REJECT_LISTING_SHAPE",
    });
    expect(transport.calls).toEqual([LST_DALARNA_PG304_ISO_URL, LST_DALARNA_PG304_ATOM_URL]);
  });

  it("does not fetch when the signed binding is absent or the wrong kind", async () => {
    const source = await signedProposal();
    const transport = scripted({}, () => true);

    await expect(new LstIsoAtomZipTargetResolver(transport).resolve({
      ...source,
      distributionBinding: undefined,
    }, "exec-1")).rejects.toMatchObject({ reason_code: "REJECT_DISTRIBUTION_IDENTITY" });
    await expect(new LstIsoAtomZipTargetResolver(transport).resolve({
      ...source,
      distributionBinding: { kind: "stac-collection", value: LST_DALARNA_PG304_FILE_IDENTIFIER },
    }, "exec-1")).rejects.toMatchObject({ reason_code: "REJECT_DISTRIBUTION_IDENTITY" });
    expect(transport.calls).toEqual([]);
  });

  it("refuses an ATOM host outside the signed domain list", async () => {
    const source = await signedProposal();
    const foreign = "https://evil.example/feed.xml";
    const transport = scripted({
      [LST_DALARNA_PG304_ISO_URL]: isoXml(LST_DALARNA_PG304_FILE_IDENTIFIER, foreign),
      [foreign]: atomXml(),
    }, (url) => isUrlAllowedForVerifiedSource(source, url));

    await expect(new LstIsoAtomZipTargetResolver(transport).resolve(source, "exec-1")).rejects.toMatchObject({
      reason_code: "REJECT_URL_SCOPE",
    });
    expect(transport.calls).toEqual([LST_DALARNA_PG304_ISO_URL, foreign]);
  });

  it("acquires the one ZIP through the governed executor and hashes those bytes", async () => {
    const source = await signedProposal();
    const transport = scripted({
      [LST_DALARNA_PG304_ISO_URL]: isoXml(),
      [LST_DALARNA_PG304_ATOM_URL]: atomXml(),
      [LST_DALARNA_PG304_ZIP_URL]: ZIP_BYTES,
    }, (url) => isUrlAllowedForVerifiedSource(source, url));
    const quarantine = memoryQuarantine();
    const executor = new GovernedDownloadExecutor(
      registryOf(source),
      new DownloadTargetResolverRegistry(registryOf(source), {
        [source.adapter]: new LstIsoAtomZipTargetResolver(transport),
      }),
      transport,
      quarantine.storage,
      new InMemoryDownloadManifestStore(),
      { now: () => "2026-10-08T06:00:00.000Z" },
    );

    const outcome = await executor.execute({
      dataset_ref: {
        id: source.sourceId,
        content_hash: { algorithm: "sha256", digest: source.sourceContentHash },
      },
      execution_id: "exec-lst-1",
      requested_at: "2026-10-08T06:00:00.000Z",
    });

    const manifestRef = requireDownloadManifestRef(outcome);
    expect(manifestRef.content_hash.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(transport.calls).toEqual([
      LST_DALARNA_PG304_ISO_URL,
      LST_DALARNA_PG304_ATOM_URL,
      LST_DALARNA_PG304_ZIP_URL,
    ]);
    const landed = [...quarantine.stored.values()][0];
    expect(landed?.meta.content_hash).toBe(createHash("sha256").update(ZIP_BYTES).digest("hex"));
    expect(landed?.meta.source_url).toBe(LST_DALARNA_PG304_ZIP_URL);
    expect(landed?.meta.status).toBe("quarantined");
  });
});

function memoryQuarantine() {
  const stored = new Map<string, { bytes: Uint8Array; meta: RawSourceArtifact }>();
  const storage: QuarantineStorage = {
    async put(sourceId, sourceUrl, fileName, bytes) {
      const hash = createHash("sha256").update(bytes).digest("hex");
      const id = `q-${stored.size + 1}`;
      const meta: RawSourceArtifact = {
        quarantine_id: id,
        source_id: sourceId,
        source_url: sourceUrl,
        file_name: fileName,
        retrieved_at: "2026-10-08T06:00:00.000Z",
        content_hash: hash,
        status: "quarantined",
      };
      stored.set(id, { bytes, meta });
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
      return [...stored.values()].map((item) => item.meta);
    },
  };
  return { storage, stored };
}
