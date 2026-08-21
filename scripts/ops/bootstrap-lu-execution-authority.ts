import { createHash } from "node:crypto";
import { MimersIntegration } from "@miljobeslut/mps-runtime";
import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import {
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityRootArtifact,
  deriveLuExecutionSeed,
  LU_EXECUTION_PRINCIPAL_ID,
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
} from "@miljobeslut/mps-lu";
import { createLuRegistryRuntime } from "../../packages/mps-lu/src/registry/createLuRegistryRuntime.js";
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from "../../packages/mps-lu/src/registry/LuSiteAssessmentRegistry.js";
import { issueExecutionIdentity } from "../../packages/mps-lu/src/execution/LuExecutionIdentityIssuer.js";
import { verifyLuExecutionAuthorityChain, attestLuExecutionAuthorityIssuer, attestLuExecutionAuthorityRoot } from "../../packages/mps-lu/src/execution/LuExecutionAuthorityChain.js";
import { buildExecutionIdentityAttestationPredicate, verifyExecutionIdentityAttestation } from "../../packages/mps-lu/src/execution/ExecutionIdentityAttestation.js";

const PROJECT_ID = "cmt2m7bdj0000h0f7uj4jykis";
const PROPERTY_BINDING_REF = { artifact_id: "project-property-binding-98339082f138a9cc602e6840", artifact_type: "project_property_binding" } as const;
const PROJECT_CONTEXT_REF = { artifact_id: "lu_project_context-dfbbbe5120fdabe0d755ce80", artifact_type: "LU_PROJECT_CONTEXT" } as const;
const PROPERTY_CONTEXT_REF = { artifact_id: "lu_property_context-f2b20ff82a5870738e316d47", artifact_type: "LU_PROPERTY_CONTEXT" } as const;
const CONTEXT_BINDING_REF = { artifact_id: "project-context-binding-32f1ff68cf89421ac4b75d86", artifact_type: "project_context_binding" } as const;
const RELEASE_REF = { artifact_id: "product-release-772aceb600c4690777593ea8", artifact_type: "product_release_manifest" } as const;
const RELEASE_HASH = "772aceb600c4690777593ea89255ce20c062648eadf6ef6e0ecee3e36808c0fa";

function required(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`LU_EXECUTION_BOOTSTRAP_REJECTED: ${name} is required`); return value; }
function fingerprint(pem: string): string { return createHash("sha256").update(pem).digest("hex"); }

async function main(): Promise<void> {
  const root = required("MIMERS_ROOT");
  const rootKeyId = required("LU_EXECUTION_AUTHORITY_ROOT_KEY_ID");
  const rootPublic = required("LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM");
  const issuerKeyId = required("LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID");
  const issuerPublic = required("LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM");
  const rootVerification = new LocalPemVerificationKeyProvider(rootKeyId, rootPublic);
  const issuerVerification = new LocalPemVerificationKeyProvider(issuerKeyId, issuerPublic);
  const mimers = await MimersIntegration.create({ env: { ...process.env, MIMERS_ROOT: root, MIMERS_REQUIRED: "1" }, forceMimers: true });

  const bareRoot = createLuExecutionAuthorityRootArtifact({ root_key_id: rootKeyId, public_key_fingerprint: fingerprint(rootPublic) });
  const bareIssuer = createLuExecutionAuthorityIssuerArtifact({ issuer_key_id: issuerKeyId, public_key_fingerprint: fingerprint(issuerPublic), root_ref: { artifact_id: bareRoot.artifact_id, artifact_type: bareRoot.artifact_type } });
  if (process.argv.includes("--verify")) {
    if (process.env.LU_EXECUTION_AUTHORITY_ROOT_PRIVATE_KEY_PEM || process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM) throw new Error("LU_EXECUTION_BOOTSTRAP_REJECTED: private key available during verification");
    await verifyLuExecutionAuthorityChain({ issuerRef: { artifact_id: bareIssuer.artifact_id, artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE }, repository: mimers.artifactRepository, rootVerification, issuerVerification });
  } else {
    if (!process.argv.includes("--execute")) throw new Error("LU_EXECUTION_BOOTSTRAP_REJECTED: refusing to write without --execute");
    const rootPrivate = required("LU_EXECUTION_AUTHORITY_ROOT_PRIVATE_KEY_PEM");
    required("LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM");
    const rootSigning = new LocalPemSigningKeyProvider(rootKeyId, rootPrivate, rootPublic);
    const authorityRoot = { ...bareRoot, attestation: await attestLuExecutionAuthorityRoot({ root: bareRoot, signing: rootSigning }) };
    const issuer = { ...bareIssuer, attestation: await attestLuExecutionAuthorityIssuer({ issuer: bareIssuer, root: authorityRoot, signing: rootSigning }) };
    await mimers.artifactRepository.put({ artifact_id: authorityRoot.artifact_id, content_hash: authorityRoot.content_hash, body: authorityRoot });
    await mimers.artifactRepository.put({ artifact_id: issuer.artifact_id, content_hash: issuer.content_hash, body: issuer });
    await verifyLuExecutionAuthorityChain({ issuerRef: { artifact_id: issuer.artifact_id, artifact_type: LU_EXECUTION_AUTHORITY_ISSUER_TYPE }, repository: mimers.artifactRepository, rootVerification, issuerVerification });
  }

  const propertyBinding = await mimers.artifactRepository.resolve<{ payload: { project_id: string; property_identity: string } }>(PROPERTY_BINDING_REF);
  if (propertyBinding.payload.project_id !== PROJECT_ID || !propertyBinding.payload.property_identity?.trim()) throw new Error("CANONICAL_SITE_ID_MISSING");
  const release = await mimers.artifactRepository.resolve<{ release_hash?: { value: string } }>(RELEASE_REF);
  if (release.release_hash?.value !== RELEASE_HASH) throw new Error("LU_EXECUTION_BOOTSTRAP_REJECTED: canonical product release mismatch");
  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY);
  if (!capability) throw new Error("LU_EXECUTION_BOOTSTRAP_REJECTED: capability unavailable");
  const siteId = propertyBinding.payload.property_identity;
  const seed = deriveLuExecutionSeed({ site_id: siteId, project_id: PROJECT_ID, project_context_ref: PROJECT_CONTEXT_REF, property_context_ref: PROPERTY_CONTEXT_REF, project_context_binding_ref: CONTEXT_BINDING_REF, product_release_ref: RELEASE_REF, product_release_hash: RELEASE_HASH, execution_contract_version: "lu-execution-identity-v1", rule_registry_snapshot_id: registry.getReleaseSnapshot().snapshot_id });
  const identity = process.argv.includes("--verify")
    ? await mimers.artifactRepository.resolve<any>({ artifact_id: `lu-identity-${siteId}`, artifact_type: "execution_identity" })
    : await issueExecutionIdentity({ site_id: siteId, deterministic_seed: seed, actor_ref: { artifact_id: LU_EXECUTION_PRINCIPAL_ID, artifact_type: "execution_identity" }, capability_ref: { artifact_id: capability.artifact_id, artifact_type: capability.artifact_type }, release_snapshot_id: registry.getReleaseSnapshot().snapshot_id, issuer_ref: { artifact_id: bareIssuer.artifact_id, artifact_type: bareIssuer.artifact_type }, governed_references: [PROPERTY_BINDING_REF, PROJECT_CONTEXT_REF, PROPERTY_CONTEXT_REF, CONTEXT_BINDING_REF, RELEASE_REF], artifact_repository: mimers.artifactRepository });
  const attestation = await mimers.artifactRepository.resolve<any>(identity.signature_envelope_ref);
  const result = await verifyExecutionIdentityAttestation({ identity, attestation, expectedPredicate: buildExecutionIdentityAttestationPredicate({ execution_identity_id: identity.artifact_id, actor_ref: identity.actor_ref, capability_ref: identity.capability_ref, release_snapshot_id: registry.getReleaseSnapshot().snapshot_id, site_id: siteId, deterministic_seed: seed }), authorityVerifier: issuerVerification });
  if (!result.verified) throw new Error(`LU_EXECUTION_BOOTSTRAP_REJECTED: execution identity verification ${result.reason}`);
  console.log(JSON.stringify({ root_artifact_id: bareRoot.artifact_id, issuer_artifact_id: bareIssuer.artifact_id, issuer_key_id: issuerKeyId, execution_identity_artifact_id: identity.artifact_id, execution_identity_hash: identity.content_hash.value, site_id: siteId, deterministic_seed: seed, release_ref: RELEASE_REF, private_key_available: !process.argv.includes("--verify"), verified: true }, null, 2));
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
