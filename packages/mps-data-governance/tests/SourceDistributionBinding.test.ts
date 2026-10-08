import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";

import {
  DownloadTargetResolverRegistry,
  SingleEndpointTargetResolver,
  type SourceAwareTargetResolver,
} from "../src/DownloadTargetResolvers";
import { GovernedDownloadError } from "../src/GovernedDownloadContracts";
import type { DistributionBinding } from "../src/SourceRegistry";
import { decidePrefetch } from "../src/PrefetchValidator";
import { approveSourceRegistryEntry } from "../src/SourceApproval";
import {
  calculateSourceRegistryContentHash,
  sourceRegistryArtifactForHash,
  verifySourceRegistryArtifact,
  type SourceRegistryArtifact,
  type VerifiedSourceDefinition,
  type VerifiedSourceRegistry,
} from "../src/SourceRegistry";
import { InMemoryValidatorBindingStore } from "../src/ValidatorBindingStore";
import { unsignedDraftFixture } from "./fixtures/unsignedSourceRegistryDrafts";

/**
 * L-V1-SOURCE-DISTRIBUTION-BINDING-01
 *
 * The binding is generic. These fixtures are not a Länsstyrelsen approval.
 */

const BINDING: DistributionBinding = {
  kind: "upstream-distribution",
  value: "dist-001",
};

const GOVERNOR_PUBLIC_KEY = join(
  process.env.USERPROFILE ?? "",
  ".mimers",
  "secrets",
  "source-registry-governor-signing-key-v1",
  "public.pem",
);

function draft(): SourceRegistryArtifact {
  return unsignedDraftFixture("puh");
}

function key() {
  return LocalPemSigningKeyProvider.generate("ed25519:test-governor").provider;
}

function registryOf(source: VerifiedSourceDefinition): VerifiedSourceRegistry {
  return {
    registryPath: "<test>",
    sources: [source],
    getSource: (id) => (id === source.sourceId ? source : null),
    isUrlAllowedForSource: () => true,
  };
}

function observing(
  identity?: DistributionBinding,
  sourceMetadata?: Readonly<Record<string, string>>,
): SourceAwareTargetResolver {
  return {
    async resolve() {
      return {
        kind: "TARGETS",
        ...(identity ? { observedDistributionIdentity: identity } : {}),
        targets: [{
          url: "https://example.test/object.zip",
          file_name: "object.zip",
          ...(sourceMetadata ? { source_metadata: sourceMetadata } : {}),
        }],
      };
    },
  };
}

describe("L-V1-SOURCE-DISTRIBUTION-BINDING-01", () => {
  it("keeps every committed approval digest when the binding is absent", () => {
    const registryPath = resolve(__dirname, "../../..", "source-registry", "national-registry.json");
    const entries = JSON.parse(readFileSync(registryPath, "utf8")) as SourceRegistryArtifact[];
    expect(entries.length).toBeGreaterThan(0);

    const admitted = entries.filter(
      (entry) => entry.source_id === "lansstyrelsen-dalarna-pg304-vattenskydd-kommunala",
    );
    expect(admitted).toHaveLength(1);
    const admittedEntry = admitted[0];
    if (!admittedEntry) throw new Error("the admitted Dalarna entry is missing");
    expect(admittedEntry.distribution_binding).toEqual({
      kind: "iso-19115-file-identifier",
      value: "7423bc91-affe-4b4d-aaab-70435393d501_C",
    });
    const admittedHash = calculateSourceRegistryContentHash(sourceRegistryArtifactForHash(admittedEntry));
    expect(admittedHash).toBe("0ce90fe6dcd144e2ea1466ff3a8563e04936c3c871129a0426d83da1722a52f5");
    expect(admittedEntry.approval_attestation.subjectDigest).toBe(`sha256:${admittedHash}`);

    const historical = entries.filter((entry) => entry !== admittedEntry);
    expect(historical.length).toBe(entries.length - 1);
    for (const entry of historical) {
      expect(entry.distribution_binding).toBeUndefined();
      const hash = calculateSourceRegistryContentHash(sourceRegistryArtifactForHash(entry));
      expect(entry.approval_attestation.subjectDigest).toBe(`sha256:${hash}`);
      expect(entry.approval_attestation.predicate).toMatchObject({
        source_content_hash: hash,
      });
    }
  });

  it.skipIf(!existsSync(GOVERNOR_PUBLIC_KEY))(
    "still verifies the committed approvals under the governor public key",
    async () => {
      const registryPath = resolve(__dirname, "../../..", "source-registry", "national-registry.json");
      const entries = JSON.parse(readFileSync(registryPath, "utf8")) as SourceRegistryArtifact[];
      const signing = new LocalPemVerificationKeyProvider(
        "ed25519:source-registry-governor-2026-08-25",
        readFileSync(GOVERNOR_PUBLIC_KEY, "utf8"),
      );

      const verified = await Promise.all(
        entries.map((entry) => verifySourceRegistryArtifact(entry, signing)),
      );
      expect(verified).toHaveLength(entries.length);
      const admitted = verified.filter(
        (source) => source.sourceId === "lansstyrelsen-dalarna-pg304-vattenskydd-kommunala",
      );
      expect(admitted).toHaveLength(1);
      expect(admitted[0]?.distributionBinding).toEqual({
        kind: "iso-19115-file-identifier",
        value: "7423bc91-affe-4b4d-aaab-70435393d501_C",
      });
      for (const source of verified) {
        if (source.sourceId === "lansstyrelsen-dalarna-pg304-vattenskydd-kommunala") continue;
        expect(source.distributionBinding).toBeUndefined();
      }
    },
  );

  it("verifies an old-shaped approval that has no distribution binding", async () => {
    const signing = key();
    const approved = await approveSourceRegistryEntry({
      entry: draft(),
      approver_actor_id: "governor:test-owner",
      signing,
    });

    const verified = await verifySourceRegistryArtifact(approved, signing);
    expect(verified.distributionBinding).toBeUndefined();
    expect(verified.sourceContentHash).toBe(
      calculateSourceRegistryContentHash(sourceRegistryArtifactForHash(draft())),
    );
  });

  it("changes sourceContentHash when a distribution binding is added", () => {
    const without = calculateSourceRegistryContentHash(sourceRegistryArtifactForHash(draft()));
    const withBinding = calculateSourceRegistryContentHash(sourceRegistryArtifactForHash({
      ...draft(),
      distribution_binding: BINDING,
    }));
    expect(withBinding).not.toBe(without);
  });

  it("invalidates an approval when only the distribution binding changes", async () => {
    const signing = key();
    const approved = await approveSourceRegistryEntry({
      entry: draft(),
      approver_actor_id: "governor:test-owner",
      signing,
    });

    await expect(verifySourceRegistryArtifact({
      ...approved,
      distribution_binding: BINDING,
    }, signing)).rejects.toThrow(/source_content_hash|subject_digest/);
  });

  it("materializes the exact signed binding onto VerifiedSourceDefinition", async () => {
    const signing = key();
    const approved = await approveSourceRegistryEntry({
      entry: { ...draft(), distribution_binding: BINDING },
      approver_actor_id: "governor:test-owner",
      signing,
    });

    const verified = await verifySourceRegistryArtifact(approved, signing);
    expect(verified.distributionBinding).toEqual(BINDING);
  });

  it("accepts an observation that matches the signed binding", async () => {
    const signing = key();
    const verified = await verifySourceRegistryArtifact(
      await approveSourceRegistryEntry({
        entry: { ...draft(), distribution_binding: BINDING },
        approver_actor_id: "governor:test-owner",
        signing,
      }),
      signing,
    );
    const plan = await new DownloadTargetResolverRegistry(registryOf(verified), {
      [verified.adapter]: observing(BINDING),
    }).resolve({ source_id: verified.sourceId, execution_id: "exec-1" });

    expect(plan.kind).toBe("TARGETS");
    if (plan.kind !== "TARGETS") return;
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]?.source_metadata).toBeUndefined();
    expect(plan.targets[0]?.strongEtagAuthority).toBeNull();
  });

  it("fails closed when the observed distribution identity differs", async () => {
    const signing = key();
    const verified = await verifySourceRegistryArtifact(
      await approveSourceRegistryEntry({
        entry: { ...draft(), distribution_binding: BINDING },
        approver_actor_id: "governor:test-owner",
        signing,
      }),
      signing,
    );

    await expect(new DownloadTargetResolverRegistry(registryOf(verified), {
      [verified.adapter]: observing({ kind: BINDING.kind, value: "dist-other" }),
    }).resolve({
      source_id: verified.sourceId,
      execution_id: "exec-1",
    })).rejects.toMatchObject({
      name: "GovernedDownloadError",
      reason_code: "REJECT_DISTRIBUTION_IDENTITY",
    });
  });

  it("fails closed when a required observation is missing", async () => {
    const signing = key();
    const verified = await verifySourceRegistryArtifact(
      await approveSourceRegistryEntry({
        entry: { ...draft(), distribution_binding: BINDING },
        approver_actor_id: "governor:test-owner",
        signing,
      }),
      signing,
    );

    await expect(new DownloadTargetResolverRegistry(registryOf(verified), {
      [verified.adapter]: new SingleEndpointTargetResolver(),
    }).resolve({
      source_id: verified.sourceId,
      execution_id: "exec-1",
    })).rejects.toBeInstanceOf(GovernedDownloadError);
  });

  it("does not accept source_metadata as a substitute for the signed binding", async () => {
    const signing = key();
    const verified = await verifySourceRegistryArtifact(
      await approveSourceRegistryEntry({
        entry: { ...draft(), distribution_binding: BINDING },
        approver_actor_id: "governor:test-owner",
        signing,
      }),
      signing,
    );

    await expect(new DownloadTargetResolverRegistry(registryOf(verified), {
      [verified.adapter]: observing(undefined, {
        iso_file_identifier: BINDING.value,
        terms_reference: "http://inspire.ec.europa.eu/metadata-codelist/ConditionsApplyingToAccessAndUse/noConditionsApply",
        atom_updated: "2026-02-16T21:52:28",
      }),
    }).resolve({
      source_id: verified.sourceId,
      execution_id: "exec-1",
    })).rejects.toMatchObject({ reason_code: "REJECT_DISTRIBUTION_IDENTITY" });
  });

  it("rejects unexpected registry fields and unexpected binding fields", async () => {
    const signing = key();
    const approved = await approveSourceRegistryEntry({
      entry: draft(),
      approver_actor_id: "governor:test-owner",
      signing,
    });

    await expect(verifySourceRegistryArtifact({
      ...approved,
      commentary: "not a registry field",
    } as unknown as SourceRegistryArtifact, signing)).rejects.toThrow(/unexpected field 'commentary'/);

    await expect(verifySourceRegistryArtifact({
      ...approved,
      distribution_binding: { ...BINDING, note: "not part of the binding" },
    } as unknown as SourceRegistryArtifact, signing)).rejects.toThrow(
      /distribution_binding rejects unexpected field 'note'/,
    );
  });

  it("does not treat a null binding as the historical omission", () => {
    expect(() => calculateSourceRegistryContentHash({
      ...sourceRegistryArtifactForHash(draft()),
      distribution_binding: null,
    } as unknown as Omit<SourceRegistryArtifact, "approval_attestation">)).toThrow(
      /must be omitted or an object/,
    );
  });

  it("fetches when no resolver declares STRONG_ETAG, including under CONTENT_HASH", async () => {
    const result = await decidePrefetch(
      {
        sourceId: "source-a",
        sourceContentHash: "hash-1",
        registryArtifactId: "reg-1",
        adapterId: "SINGLE_ENDPOINT_V1",
        strongEtagAuthority: null,
        changeDetectionStrategy: "CONTENT_HASH",
        locatorIdentity: "https://example.test/object.zip",
        targetIdentity: "https://example.test/object.zip\nobject.zip",
        fileNameDeclared: true,
        validatorClass: "STRONG_ETAG",
        method: "HEAD",
        performLiveExchange: false,
      },
      new InMemoryValidatorBindingStore(),
      null,
      () => "2026-10-08T00:00:00.000Z",
    );

    expect(result).toEqual({
      decision: "FETCH",
      reasonCode: "SIGNAL_CLASS_FORBIDDEN",
    });
  });
});
