import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ArtifactIdentityStrategy,
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
} from "../../mps-core/src/types";
import { DatasetApprovalAuthority } from "../src/DatasetApprovalAuthority";
import { FileCheckpointStore } from "../src/FileCheckpointStore";
import { FileDatasetApprovalStore } from "../src/FileDatasetApprovalStore";
import { ImportGate } from "../src/ImportGate";
import type { ImportGateEvidenceArtifact } from "../src/ImportGateTypes";
import {
  DATASET_APPROVAL_AUTHORITY_DOMAIN,
  inventoryForeignSignerCandidates,
} from "../src/DatasetApprovalAuthorityDomain";
import { createDatasetApprovalEd25519Signer } from "../src/DatasetApprovalEd25519Signer";
import {
  loadDatasetApprovalSignerFromEnv,
  DatasetApprovalSigningAuthorityError,
} from "../src/DatasetApprovalSigningAuthority";
import {
  createDatasetApprovalSignatureVerifier,
  createDatasetApprovalTrustPort,
  createDatasetApprovalTrustRoot,
  loadDatasetApprovalTrustRootFromEnv,
  DatasetApprovalTrustRootError,
} from "../src/DatasetApprovalTrustRoot";
import {
  loadGovernanceReviewerRegistry,
  GovernanceReviewerIdentityError,
} from "../src/GovernanceReviewerIdentityResolver";
import {
  resolveGovernedDataRoots,
  requireMasterArchiveRootForDatasetApproval,
  GovernedDataRootError,
} from "../src/GovernedDataRootResolver";
import {
  probeByggnadenReadonlyCompatibility,
  probeDatasetApprovalAuthorityActivation,
  runIsolatedDatasetApprovalAuthorityDryRun,
  BYGGNADEN_READONLY_TARGET,
} from "../src/DatasetApprovalAuthorityBindings";

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort().map(([k, v]) => [k, sort(v)]),
  );
}

const serializer: CanonicalArtifactSerializer = {
  serialize: (v) => new TextEncoder().encode(JSON.stringify(sort(v))),
};
const hashEngine: CanonicalHashEngine = {
  hash: (bytes) => ({
    algorithm: "sha256",
    digest: createHash("sha256").update(bytes).digest("hex"),
  }),
};
const strategy: ArtifactIdentityStrategy = {
  createArtifactId: (h) => `approval-${h.digest.slice(0, 24)}`,
};

function pemPair(keyId: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    keyId,
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

describe("DatasetApprovalAuthorityActivation bindings", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  it("inventories foreign signers as NOT authorized for DatasetApproval", () => {
    const inventory = inventoryForeignSignerCandidates();
    expect(inventory.length).toBeGreaterThan(0);
    for (const candidate of inventory) {
      expect(candidate.dataset_approval_authorization).toBe("NOT_PROVEN");
      expect(candidate.authority_domain).not.toBe(DATASET_APPROVAL_AUTHORITY_DOMAIN);
    }
  });

  it("treats reviewer registry as authorization grants only (role structurally required)", () => {
    const root = tempDir("da-reviewer-");
    const registryPath = join(root, "reviewers.json");
    const identity = {
      id: "human-identity-operational-reviewer-a1b2c3",
      content_hash: { algorithm: "sha256", digest: "d".repeat(64) },
    };
    writeFileSync(
      registryPath,
      JSON.stringify({
        reviewers: [{ identity_ref: identity, role: "GOVERNANCE_REVIEWER" }],
      }),
      "utf8",
    );
    const env = { DATASET_APPROVAL_REVIEWER_REGISTRY_FILE: registryPath } as NodeJS.ProcessEnv;
    const registry = loadGovernanceReviewerRegistry(env);
    expect(registry).toHaveLength(1);
    expect(registry[0]!.role).toBe("GOVERNANCE_REVIEWER");

    writeFileSync(
      registryPath,
      JSON.stringify({
        reviewers: [{ identity_ref: identity, role: "HUMAN_OPERATOR" }],
      }),
      "utf8",
    );
    expect(() => loadGovernanceReviewerRegistry(env)).toThrow(/REJECT_DATASET_APPROVAL_REVIEWER_ROLE/);
    expect(() => loadGovernanceReviewerRegistry({} as NodeJS.ProcessEnv)).toThrow(
      GovernanceReviewerIdentityError,
    );
  });

  it("loads DatasetApproval signer/trust only for DATASET_APPROVAL domain and rejects foreign env reuse", () => {
    const pair = pemPair("ed25519:dataset-approval-v1");
    const env = {
      DATASET_APPROVAL_SIGNING_KEY_ID: pair.keyId,
      DATASET_APPROVAL_SIGNING_PRIVATE_KEY_PEM: pair.privatePem,
      DATASET_APPROVAL_SIGNING_PUBLIC_KEY_PEM: pair.publicPem,
    } as NodeJS.ProcessEnv;
    const trust = loadDatasetApprovalTrustRootFromEnv(env);
    expect(trust.authority_domain).toBe(DATASET_APPROVAL_AUTHORITY_DOMAIN);
    const signer = loadDatasetApprovalSignerFromEnv(env, trust);
    expect(signer.keyId).toBe(pair.keyId);

    expect(() =>
      loadDatasetApprovalSignerFromEnv({
        GOVERNANCE_SIGNING_PRIVATE_KEY_PEM: pair.privatePem,
      } as NodeJS.ProcessEnv),
    ).toThrow(DatasetApprovalSigningAuthorityError);

    expect(() =>
      createDatasetApprovalTrustRoot([
        {
          key_id: "ed25519:governance-promotion-v1",
          public_key_pem: pair.publicPem,
          authority_domain: "CAS_PROMOTION" as any,
        },
      ]),
    ).toThrow(/REJECT_DATASET_APPROVAL_TRUST_DOMAIN/);
  });

  it("rejects untrusted signer, wrong-domain signer, and caller-supplied trust substitution", async () => {
    const trusted = pemPair("ed25519:dataset-approval-v1");
    const foreign = pemPair("ed25519:governance-promotion-v1");
    const trustRoot = createDatasetApprovalTrustRoot([
      {
        key_id: trusted.keyId,
        public_key_pem: trusted.publicPem,
        authority_domain: DATASET_APPROVAL_AUTHORITY_DOMAIN,
      },
    ]);
    const trust = createDatasetApprovalTrustPort(trustRoot);
    const verifier = createDatasetApprovalSignatureVerifier(trustRoot);
    await expect(trust.assertTrustedDatasetApprovalSigner(foreign.keyId)).rejects.toThrow(
      "REJECT_UNTRUSTED_DATASET_APPROVAL_SIGNER",
    );
    await expect(trust.assertTrustedDatasetApprovalSigner("ed25519:unknown")).rejects.toThrow(
      "REJECT_UNTRUSTED_DATASET_APPROVAL_SIGNER",
    );

    const foreignSigner = createDatasetApprovalEd25519Signer({
      keyId: foreign.keyId,
      privateKeyPem: foreign.privatePem,
      publicKeyPem: foreign.publicPem,
    });
    const digest = { algorithm: "sha256", digest: "aa".repeat(32) };
    const sig = await foreignSigner.sign(digest);
    expect(await verifier.verify(digest, sig)).toBe(false);

    const callerRoot = createDatasetApprovalTrustRoot([
      {
        key_id: foreign.keyId,
        public_key_pem: foreign.publicPem,
        authority_domain: DATASET_APPROVAL_AUTHORITY_DOMAIN,
      },
    ]);
    const callerVerifier = createDatasetApprovalSignatureVerifier(callerRoot);
    expect(await callerVerifier.verify(digest, sig)).toBe(true);
    expect(await verifier.verify(digest, sig)).toBe(false);
  });

  it("separates MIMERS_ROOT runtime from governed Master/CAS/Quarantine roots", () => {
    const root = tempDir("da-roots-");
    const mimers = join(root, "mimers");
    const master = join(root, "Master");
    const cas = join(root, "CAS");
    const quarantine = join(root, "Quarantine");
    for (const dir of [mimers, master, cas, quarantine]) mkdirSync(dir);

    const separated = resolveGovernedDataRoots({
      MIMERS_ROOT: mimers,
      MASTER_ARCHIVE_ROOT: master,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
    } as NodeJS.ProcessEnv);
    expect(separated.runtimeDataRootSeparation).toBe("PASS");
    expect(separated.masterVisible).toBe(true);
    expect(separated.casVisible).toBe(true);
    expect(separated.quarantineVisible).toBe(true);
    expect(separated.mimersRootPurpose).toBe("runtime_config_secrets");
    expect(requireMasterArchiveRootForDatasetApproval({
      MASTER_ARCHIVE_ROOT: master,
      CAS_ROOT: cas,
      QUARANTINE_ROOT: quarantine,
      MIMERS_ROOT: mimers,
    } as NodeJS.ProcessEnv)).toBe(master);

    const blocked = resolveGovernedDataRoots({ MIMERS_ROOT: mimers } as NodeJS.ProcessEnv);
    expect(blocked.masterRoot).toBeNull();
    expect(blocked.blocker).toMatch(/BLOCKED_BY_RUNTIME_ROOT_CONFIGURATION/);
    expect(() =>
      requireMasterArchiveRootForDatasetApproval({ MIMERS_ROOT: mimers } as NodeJS.ProcessEnv),
    ).toThrow(GovernedDataRootError);
  });

  it("runs isolated authority dry-run without production approval side effects", async () => {
    const result = await runIsolatedDatasetApprovalAuthorityDryRun({
      reviewerIdentityRef: {
        id: "human-identity-operational-reviewer-dryrun",
        content_hash: { algorithm: "sha256", digest: "c".repeat(64) },
      },
      producerIdentityRef: {
        id: "harvest-agent-loke",
        content_hash: { algorithm: "sha256", digest: "b".repeat(64) },
      },
    });
    expect(result.authority_dry_run).toBe("PASS");
    expect(result.production_verifier).toBe("PASS");
    expect(result.untrusted_signer).toBe("REJECTED");
    expect(result.wrong_authority_domain_signer).toBe("REJECTED");
    expect(result.self_approval).toBe("REJECTED");
    expect(result.caller_supplied_trust_root).toBe("REJECTED");
    expect(result.persisted).toBe(false);
  });

  it("proves persist/reload + ImportGate compatibility through production verifier bindings", async () => {
    const root = tempDir("da-bind-e2e-");
    const trusted = pemPair("ed25519:dataset-approval-v1");
    const trustRoot = createDatasetApprovalTrustRoot([
      {
        key_id: trusted.keyId,
        public_key_pem: trusted.publicPem,
        authority_domain: DATASET_APPROVAL_AUTHORITY_DOMAIN,
      },
    ]);
    const trust = createDatasetApprovalTrustPort(trustRoot);
    const verifier = createDatasetApprovalSignatureVerifier(trustRoot);
    const signer = createDatasetApprovalEd25519Signer({
      keyId: trusted.keyId,
      privateKeyPem: trusted.privatePem,
      publicKeyPem: trusted.publicPem,
    });
    const manifest = {
      id: BYGGNADEN_READONLY_TARGET.manifest_execution_id,
      content_hash: {
        algorithm: "sha256",
        digest: BYGGNADEN_READONLY_TARGET.content_sha256,
      },
    };
    const producer = {
      identity_ref: { id: "harvest-agent-loke", content_hash: { algorithm: "sha256", digest: "b".repeat(64) } },
      role: "SYSTEM_PROCESS" as const,
    };
    const reviewer = {
      identity_ref: {
        id: "human-identity-operational-reviewer-a1b2c3",
        content_hash: { algorithm: "sha256", digest: "c".repeat(64) },
      },
      role: "GOVERNANCE_REVIEWER" as const,
    };
    const checkpoints = new FileCheckpointStore(root, serializer, hashEngine, verifier);
    const authority = new DatasetApprovalAuthority(
      serializer,
      hashEngine,
      signer,
      strategy,
      { resolveVerifiedManifest: async (ref) => ({ manifest_ref: ref, producer }) },
      trust,
      new FileDatasetApprovalStore(root),
      checkpoints,
    );
    const ref = await authority.decide({
      manifest_ref: manifest,
      decision: "APPROVED",
      actor_ref: reviewer,
      decision_at: "2026-10-10T00:00:00.000Z",
      reason: "Activation binding compatibility proof (fixture master root).",
    });
    const artifact = await checkpoints.loadApproval(ref);
    expect(artifact.signature.key_id).toBe(trusted.keyId);

    const stored = new Map<string, ImportGateEvidenceArtifact>();
    const gate = new ImportGate(serializer, hashEngine, signer, strategy, {
      put: async (a) => {
        stored.set(a.artifact_id, a);
        return { artifact_id: a.artifact_id, artifact_type: a.artifact_type, content_hash: a.content_hash };
      },
    });
    await expect(
      gate.evaluate(
        {
          manifest_ref: manifest,
          approval_artifact: artifact,
          compliance_results: [{ control_id: "MB-006", result: "PASS" }],
        },
        "2026-10-10T00:01:00.000Z",
      ),
    ).resolves.toMatchObject({ decision: "ALLOW_IMPORT" });

    // Tamper / wrong approved_ref / missing approval negatives via gate + reload
    const path = join(root, "National_Archive", "_quarantine", "approvals", `${ref.artifact_id}.json`);
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    onDisk.reason = "tampered";
    writeFileSync(path, JSON.stringify(onDisk), "utf8");
    await expect(checkpoints.loadApproval(ref)).rejects.toThrow(/content does not match/);

    await expect(
      gate.evaluate(
        {
          manifest_ref: { ...manifest, id: "other" },
          approval_artifact: artifact,
          compliance_results: [],
        },
        "2026-10-10T00:01:00.000Z",
      ),
    ).resolves.toMatchObject({ decision: "BLOCK_IMPORT" });
    await expect(
      gate.evaluate(
        { manifest_ref: manifest, approval_artifact: null, compliance_results: [] },
        "2026-10-10T00:01:00.000Z",
      ),
    ).resolves.toMatchObject({ decision: "BLOCK_IMPORT" });
    await expect(
      gate.evaluate(
        {
          manifest_ref: manifest,
          approval_artifact: { ...artifact, decision: "REJECTED" },
          compliance_results: [],
        },
        "2026-10-10T00:01:00.000Z",
      ),
    ).resolves.toMatchObject({ decision: "BLOCK_IMPORT" });
    await expect(
      gate.evaluate(
        {
          manifest_ref: manifest,
          approval_artifact: artifact,
          compliance_results: [{ control_id: "MB-006", result: "FAIL" }],
        },
        "2026-10-10T00:01:00.000Z",
      ),
    ).resolves.toMatchObject({ decision: "BLOCK_IMPORT" });
  });

  it("reports operational blockers without issuing Byggnaden approval", () => {
    const report = probeDatasetApprovalAuthorityActivation(
      { MIMERS_ROOT: join(tmpdir(), "no-such-mimers-for-activation") } as NodeJS.ProcessEnv,
      { cwd: process.cwd() },
    );
    expect(report.real_byggnaden_approval_issued).toBe(false);
    expect(report.real_importgate_byggnaden).toBe("NOT_RUN");
    expect(report.real_master_cas_write).toBe(false);
    expect(report.postgis).toBe("NOT_STARTED");
    expect(report.byggnaden_manifest_compatibility).toBe(
      existsSync(join(process.cwd(), "source-registry", "national-registry.json")) ? "PASS" : "FAIL",
    );
    expect(report.existing_dataset_approval_compatible_signer).toBe("NO");
    expect(report.blockers.some((b) => b.includes("BLOCKED_BY_"))).toBe(true);
  });

  it("accepts Byggnaden registry artifact id for read-only compatibility", () => {
    expect(probeByggnadenReadonlyCompatibility({ cwd: process.cwd() })).toBe("PASS");
    expect(BYGGNADEN_READONLY_TARGET.registry_artifact_id).toBe("reg-lantmateriet-stac-byggnader-002");
  });

  it("refuses trust-root load when authority_domain is wrong in file", () => {
    const root = tempDir("da-trust-file-");
    const file = join(root, "keys.json");
    const pair = pemPair("ed25519:dataset-approval-v1");
    writeFileSync(
      file,
      JSON.stringify({
        authority_domain: "CAS_PROMOTION",
        keys: { [pair.keyId]: pair.publicPem },
      }),
      "utf8",
    );
    expect(() =>
      loadDatasetApprovalTrustRootFromEnv({
        DATASET_APPROVAL_TRUSTED_KEYS_FILE: file,
      } as NodeJS.ProcessEnv),
    ).toThrow(DatasetApprovalTrustRootError);
  });
});
