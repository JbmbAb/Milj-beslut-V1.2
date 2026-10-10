import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ArtifactIdentityStrategy,
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  ContentReference,
} from "../../mps-core/src/types";
import { ArtifactIdentityBuilder, createSignedArtifactIdentity } from "../../mps-core/src/identity";
import {
  DatasetApprovalAuthority,
  type DatasetApprovalSigner,
  type HarvestManifestAuthorityPort,
} from "./DatasetApprovalAuthority";
import { DatasetApprovalController } from "./DatasetApprovalController";
import {
  DATASET_APPROVAL_AUTHORITY_DOMAIN,
  inventoryForeignSignerCandidates,
  type SignerAuthorityCandidate,
} from "./DatasetApprovalAuthorityDomain";
import { createDatasetApprovalEd25519Signer } from "./DatasetApprovalEd25519Signer";
import { FileCheckpointStore } from "./FileCheckpointStore";
import { FileDatasetApprovalStore } from "./FileDatasetApprovalStore";
import {
  resolveAuthenticatedGovernanceReviewer,
  resolveSoleConfiguredGovernanceReviewer,
  loadGovernanceReviewerRegistry,
} from "./GovernanceReviewerIdentityResolver";
import {
  resolveGovernedDataRoots,
  requireMasterArchiveRootForDatasetApproval,
  type GovernedDataRootResolution,
} from "./GovernedDataRootResolver";
import { loadDatasetApprovalSignerFromEnv } from "./DatasetApprovalSigningAuthority";
import {
  createDatasetApprovalSignatureVerifier,
  createDatasetApprovalTrustPort,
  createDatasetApprovalTrustRoot,
  loadDatasetApprovalTrustRootFromEnv,
  type DatasetApprovalTrustRoot,
} from "./DatasetApprovalTrustRoot";

export const BYGGNADEN_READONLY_TARGET = {
  registry_artifact_id: "reg-lantmateriet-stac-byggnader-002",
  quarantine_id: "7f4ae7b2-0fa0-483d-874d-9deb149329f2",
  manifest_execution_id: "pilot-lantmateriet-stac-byggnader-45542dc9-16d8-4900-bc4c-0b79966f05a4",
  content_sha256: "3f181b42ce87f36e9888057df9fc1b5ac384b7b71e764de66ba396d10c993a69",
} as const;

export interface DatasetApprovalAuthorityActivationReport {
  readonly existing_dataset_approval_compatible_signer: "YES" | "NO";
  readonly existing_governance_reviewer_identity: "YES" | "NO";
  readonly existing_trust_anchor_authorizing_dataset_approval: "YES" | "NO";
  readonly signer_authority_inventory: readonly SignerAuthorityCandidate[];
  readonly governance_reviewer_identity: "RESOLVED" | "BLOCKED";
  readonly governance_reviewer_identity_ref: string | null;
  readonly dataset_approval_signer: "RESOLVED" | "BLOCKED";
  readonly signer_key_id: string | null;
  readonly signer_authority_domain: string | null;
  readonly dataset_approval_authorization: "PROVEN" | "NOT_PROVEN";
  readonly trust_root: "RESOLVED" | "BLOCKED";
  readonly roots: GovernedDataRootResolution;
  readonly byggnaden_manifest_compatibility: "PASS" | "FAIL";
  readonly authority_dry_run: "PASS" | "FAIL" | "SKIPPED";
  readonly blockers: readonly string[];
  readonly real_byggnaden_approval_issued: false;
  readonly real_importgate_byggnaden: "NOT_RUN";
  readonly real_master_cas_write: false;
  readonly postgis: "NOT_STARTED";
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort().map(([k, v]) => [k, sort(v)]),
  );
}

const defaultSerializer: CanonicalArtifactSerializer = {
  serialize: (v) => new TextEncoder().encode(JSON.stringify(sort(v))),
};
const defaultHash: CanonicalHashEngine = {
  hash: (bytes) => ({
    algorithm: "sha256",
    digest: createHash("sha256").update(bytes).digest("hex"),
  }),
};
const defaultStrategy: ArtifactIdentityStrategy = {
  createArtifactId: (h) => `approval-${h.digest.slice(0, 24)}`,
};

async function expectRejection(run: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(code)) return;
    throw new Error(`Expected rejection '${code}', got: ${message}`);
  }
  throw new Error(`Expected rejection '${code}', but call succeeded`);
}

export function probeByggnadenReadonlyCompatibility(options: {
  readonly registryPath?: string;
  readonly cwd?: string;
} = {}): "PASS" | "FAIL" {
  const registryPath = resolve(
    options.registryPath ??
      resolve(options.cwd ?? process.cwd(), "source-registry", "national-registry.json"),
  );
  if (!existsSync(registryPath)) return "FAIL";
  try {
    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as Array<{ artifact_id?: string }>;
    const hit = raw.find((e) => e.artifact_id === BYGGNADEN_READONLY_TARGET.registry_artifact_id);
    return hit ? "PASS" : "FAIL";
  } catch {
    return "FAIL";
  }
}

/**
 * Operational activation probe. Never issues a real Byggnaden approval and never
 * writes Master/CAS.
 */
export function probeDatasetApprovalAuthorityActivation(
  env: NodeJS.ProcessEnv = process.env,
  options: { readonly cwd?: string; readonly registryPath?: string } = {},
): DatasetApprovalAuthorityActivationReport {
  const inventory = inventoryForeignSignerCandidates();
  const roots = resolveGovernedDataRoots(env);
  const blockers: string[] = [];

  let governance_reviewer_identity: "RESOLVED" | "BLOCKED" = "BLOCKED";
  let governance_reviewer_identity_ref: string | null = null;
  try {
    const registry = loadGovernanceReviewerRegistry(env);
    governance_reviewer_identity = "RESOLVED";
    governance_reviewer_identity_ref = registry.length === 1
      ? registry[0]!.identity_ref.id
      : `${registry.length}_registered_require_auth_selection`;
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  let trust_root: "RESOLVED" | "BLOCKED" = "BLOCKED";
  let trust: DatasetApprovalTrustRoot | null = null;
  try {
    trust = loadDatasetApprovalTrustRootFromEnv(env);
    trust_root = "RESOLVED";
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  let dataset_approval_signer: "RESOLVED" | "BLOCKED" = "BLOCKED";
  let signer_key_id: string | null = null;
  try {
    const signer = loadDatasetApprovalSignerFromEnv(env, trust ?? undefined);
    dataset_approval_signer = "RESOLVED";
    signer_key_id = signer.keyId;
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  if (roots.blocker) blockers.push(roots.blocker);

  return {
    existing_dataset_approval_compatible_signer: dataset_approval_signer === "RESOLVED" ? "YES" : "NO",
    existing_governance_reviewer_identity: governance_reviewer_identity === "RESOLVED" ? "YES" : "NO",
    existing_trust_anchor_authorizing_dataset_approval: trust_root === "RESOLVED" ? "YES" : "NO",
    signer_authority_inventory: inventory,
    governance_reviewer_identity,
    governance_reviewer_identity_ref,
    dataset_approval_signer,
    signer_key_id,
    signer_authority_domain:
      dataset_approval_signer === "RESOLVED" ? DATASET_APPROVAL_AUTHORITY_DOMAIN : null,
    dataset_approval_authorization:
      dataset_approval_signer === "RESOLVED" && trust_root === "RESOLVED" ? "PROVEN" : "NOT_PROVEN",
    trust_root,
    roots,
    byggnaden_manifest_compatibility: probeByggnadenReadonlyCompatibility(options),
    authority_dry_run: "SKIPPED",
    blockers: [...new Set(blockers)],
    real_byggnaden_approval_issued: false,
    real_importgate_byggnaden: "NOT_RUN",
    real_master_cas_write: false,
    postgis: "NOT_STARTED",
  };
}

export interface IsolatedAuthorityDryRunResult {
  readonly authority_dry_run: "PASS";
  readonly production_verifier: "PASS";
  readonly untrusted_signer: "REJECTED";
  readonly wrong_authority_domain_signer: "REJECTED";
  readonly self_approval: "REJECTED";
  readonly caller_supplied_trust_root: "REJECTED";
  readonly signer_key_id: string;
  readonly reviewer_identity_ref: string;
  readonly persisted: false;
}

/**
 * Non-mutating dry-run using isolated ephemeral keys. Proves binding mechanics.
 * Does not persist under production Master roots and does not issue Byggnaden approval.
 */
export async function runIsolatedDatasetApprovalAuthorityDryRun(input: {
  readonly reviewerIdentityRef: ContentReference;
  readonly producerIdentityRef: ContentReference;
  readonly manifestRef?: ContentReference;
}): Promise<IsolatedAuthorityDryRunResult> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const keyId = "ed25519:dataset-approval-isolated-dry-run-v1";

  const trustRoot = createDatasetApprovalTrustRoot([
    { key_id: keyId, public_key_pem: publicPem, authority_domain: DATASET_APPROVAL_AUTHORITY_DOMAIN },
  ]);
  const trust = createDatasetApprovalTrustPort(trustRoot);
  const verifier = createDatasetApprovalSignatureVerifier(trustRoot);
  const signer = createDatasetApprovalEd25519Signer({
    keyId,
    privateKeyPem: privatePem,
    publicKeyPem: publicPem,
  });

  const foreign = generateKeyPairSync("ed25519");
  const foreignPem = foreign.publicKey.export({ type: "spki", format: "pem" }).toString();
  const foreignPrivate = foreign.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const foreignSigner = createDatasetApprovalEd25519Signer({
    keyId: "ed25519:governance-promotion-v1",
    privateKeyPem: foreignPrivate,
    publicKeyPem: foreignPem,
  });

  await expectRejection(
    () => trust.assertTrustedDatasetApprovalSigner(foreignSigner.keyId),
    "REJECT_UNTRUSTED_DATASET_APPROVAL_SIGNER",
  );
  await expectRejection(
    () => trust.assertTrustedDatasetApprovalSigner("ed25519:unknown"),
    "REJECT_UNTRUSTED_DATASET_APPROVAL_SIGNER",
  );

  const hash = { algorithm: "sha256", digest: "ab".repeat(32) };
  const foreignSig = await foreignSigner.sign(hash);
  if (await verifier.verify(hash, foreignSig)) {
    throw new Error("FAIL: production verifier accepted untrusted/wrong-domain signer");
  }

  // A caller-built trust root must not replace the composed verifier's root.
  const callerTrust = createDatasetApprovalTrustRoot([
    {
      key_id: foreignSigner.keyId,
      public_key_pem: foreignPem,
      authority_domain: DATASET_APPROVAL_AUTHORITY_DOMAIN,
    },
  ]);
  const callerVerifier = createDatasetApprovalSignatureVerifier(callerTrust);
  if (!(await callerVerifier.verify(hash, foreignSig))) {
    throw new Error("FAIL: caller trust fixture did not verify its own key");
  }
  if (await verifier.verify(hash, foreignSig)) {
    throw new Error("FAIL: caller-supplied trust root influenced production verifier");
  }

  const manifest: ContentReference = input.manifestRef ?? {
    id: BYGGNADEN_READONLY_TARGET.manifest_execution_id,
    content_hash: {
      algorithm: "sha256",
      digest: BYGGNADEN_READONLY_TARGET.content_sha256,
    },
  };
  const reviewer = {
    identity_ref: input.reviewerIdentityRef,
    role: "GOVERNANCE_REVIEWER" as const,
  };
  const producer = {
    identity_ref: input.producerIdentityRef,
    role: "SYSTEM_PROCESS" as const,
  };

  await trust.assertTrustedDatasetApprovalSigner(signer.keyId);
  const builder = new ArtifactIdentityBuilder(
    defaultSerializer,
    defaultHash,
    signer,
    defaultStrategy,
  );
  const signed = await createSignedArtifactIdentity(
    {
      artifact_type: "DATASET_APPROVAL" as const,
      approved_ref: manifest,
      decision: "APPROVED" as const,
      actor_ref: reviewer,
      decision_at: "2026-10-10T00:00:00.000Z",
      reason: "Isolated DatasetApproval authority dry-run (non-persisting).",
    },
    builder,
  );
  if (!(await verifier.verify(signed.content_hash, signed.signature))) {
    throw new Error("FAIL: production verifier rejected isolated dry-run signature");
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "dataset-approval-dry-run-"));
  try {
    const checkpoints = new FileCheckpointStore(
      tempRoot,
      defaultSerializer,
      defaultHash,
      verifier,
    );
    const authority = new DatasetApprovalAuthority(
      defaultSerializer,
      defaultHash,
      signer,
      defaultStrategy,
      { resolveVerifiedManifest: async (ref) => ({ manifest_ref: ref, producer }) },
      trust,
      new FileDatasetApprovalStore(tempRoot),
      checkpoints,
    );
    await expectRejection(
      () =>
        authority.decide({
          manifest_ref: manifest,
          decision: "APPROVED",
          actor_ref: { ...reviewer, identity_ref: producer.identity_ref },
          decision_at: "2026-10-10T00:00:00.000Z",
          reason: "should fail self approval",
        }),
      "REJECT_DATASET_APPROVAL_SELF_APPROVAL",
    );
    await expectRejection(
      () =>
        authority.decide({
          manifest_ref: manifest,
          decision: "APPROVED",
          actor_ref: { ...reviewer, role: "HUMAN_OPERATOR" },
          decision_at: "2026-10-10T00:00:00.000Z",
          reason: "should fail role",
        }),
      "REJECT_DATASET_APPROVAL_REVIEWER_ROLE",
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  return {
    authority_dry_run: "PASS",
    production_verifier: "PASS",
    untrusted_signer: "REJECTED",
    wrong_authority_domain_signer: "REJECTED",
    self_approval: "REJECTED",
    caller_supplied_trust_root: "REJECTED",
    signer_key_id: keyId,
    reviewer_identity_ref: reviewer.identity_ref.id,
    persisted: false,
  };
}

/**
 * Production composition. Fails closed when reviewer / signer / trust / master root
 * are not operationally provisioned. Never accepts caller-selected signer or trust root.
 */
export function composeDatasetApprovalAuthorityFromEnv(input: {
  readonly env?: NodeJS.ProcessEnv;
  readonly serializer?: CanonicalArtifactSerializer;
  readonly hashEngine?: CanonicalHashEngine;
  readonly identityStrategy?: ArtifactIdentityStrategy;
  readonly manifests: HarvestManifestAuthorityPort;
  readonly authenticatedReviewerIdentityRef: ContentReference;
}): {
  readonly controller: DatasetApprovalController;
  readonly authority: DatasetApprovalAuthority;
  readonly trustRoot: DatasetApprovalTrustRoot;
  readonly signer: DatasetApprovalSigner;
  readonly masterRoot: string;
} {
  const env = input.env ?? process.env;
  const serializer = input.serializer ?? defaultSerializer;
  const hashEngine = input.hashEngine ?? defaultHash;
  const identityStrategy = input.identityStrategy ?? defaultStrategy;

  const reviewer = resolveAuthenticatedGovernanceReviewer(
    input.authenticatedReviewerIdentityRef,
    env,
  );
  const trustRoot = loadDatasetApprovalTrustRootFromEnv(env);
  const signer = loadDatasetApprovalSignerFromEnv(env, trustRoot);
  const trust = createDatasetApprovalTrustPort(trustRoot);
  const verifier = createDatasetApprovalSignatureVerifier(trustRoot);
  const masterRoot = requireMasterArchiveRootForDatasetApproval(env);
  const checkpoints = new FileCheckpointStore(masterRoot, serializer, hashEngine, verifier);
  const authority = new DatasetApprovalAuthority(
    serializer,
    hashEngine,
    signer,
    identityStrategy,
    input.manifests,
    trust,
    new FileDatasetApprovalStore(masterRoot),
    checkpoints,
  );
  return {
    controller: new DatasetApprovalController(authority, reviewer),
    authority,
    trustRoot,
    signer,
    masterRoot,
  };
}

/** Exposed for activation tests that need the sole-reviewer dry-run path. */
export { resolveSoleConfiguredGovernanceReviewer };
