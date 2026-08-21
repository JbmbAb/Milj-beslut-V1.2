import { createArtifactAttestation, verifyArtifactAttestation, type SigningKeyProvider, type VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import {
  LU_EXECUTION_AUTHORITY_ISSUER_TYPE,
  LU_EXECUTION_AUTHORITY_ROOT_TYPE,
  LU_EXECUTION_AUTHORITY_SCOPE,
  type LuExecutionAuthorityIssuerArtifact,
  type LuExecutionAuthorityRootArtifact,
  validateLuExecutionAuthorityIssuerArtifact,
  validateLuExecutionAuthorityRootArtifact,
} from "../artifacts/LuExecutionAuthorityArtifact.js";

const ROOT_PREDICATE = "lu.execution_authority_root.v1";
const ISSUER_PREDICATE = "lu.execution_authority_issuer.v1";

function rootPredicate(root: LuExecutionAuthorityRootArtifact) {
  return { scope: LU_EXECUTION_AUTHORITY_SCOPE, allowed_artifact_type: "execution_identity", owner_provisioning: root.payload.owner_provisioning };
}
function issuerPredicate(issuer: LuExecutionAuthorityIssuerArtifact) {
  return { scope: LU_EXECUTION_AUTHORITY_SCOPE, allowed_artifact_type: "execution_identity", root_ref: issuer.payload.root_ref };
}

export async function attestLuExecutionAuthorityRoot(args: { readonly root: Omit<LuExecutionAuthorityRootArtifact, "attestation">; readonly signing: SigningKeyProvider }) {
  if (args.root.payload.root_key_id !== args.signing.keyId) throw new Error("REJECT_LU_EXECUTION_AUTHORITY_ROOT_KEY");
  return createArtifactAttestation({ subjectDigest: args.root.content_hash.value, predicateType: ROOT_PREDICATE, predicate: rootPredicate(args.root), signing: args.signing });
}

export async function attestLuExecutionAuthorityIssuer(args: { readonly issuer: Omit<LuExecutionAuthorityIssuerArtifact, "attestation">; readonly root: LuExecutionAuthorityRootArtifact; readonly signing: SigningKeyProvider }) {
  if (args.root.payload.root_key_id !== args.signing.keyId) throw new Error("REJECT_LU_EXECUTION_AUTHORITY_ROOT_KEY");
  if (args.issuer.payload.root_ref.artifact_id !== args.root.artifact_id || args.issuer.payload.root_ref.artifact_type !== args.root.artifact_type) throw new Error("REJECT_LU_EXECUTION_AUTHORITY_ISSUER_ROOT_REF");
  return createArtifactAttestation({ subjectDigest: args.issuer.content_hash.value, predicateType: ISSUER_PREDICATE, predicate: issuerPredicate(args.issuer), signing: args.signing });
}

export async function verifyLuExecutionAuthorityChain(args: { readonly issuerRef: { readonly artifact_id: string; readonly artifact_type: string }; readonly repository: ArtifactRepositoryPort; readonly rootVerification: VerificationKeyProvider; readonly issuerVerification: VerificationKeyProvider }): Promise<LuExecutionAuthorityIssuerArtifact> {
  const issuer = validateLuExecutionAuthorityIssuerArtifact(await args.repository.resolve<LuExecutionAuthorityIssuerArtifact>(args.issuerRef));
  if (issuer.artifact_type !== LU_EXECUTION_AUTHORITY_ISSUER_TYPE || issuer.payload.issuer_key_id !== args.issuerVerification.keyId) throw new Error("REJECT_LU_EXECUTION_AUTHORITY_ISSUER_TRUST");
  const root = validateLuExecutionAuthorityRootArtifact(await args.repository.resolve<LuExecutionAuthorityRootArtifact>(issuer.payload.root_ref));
  if (root.artifact_type !== LU_EXECUTION_AUTHORITY_ROOT_TYPE || root.payload.root_key_id !== args.rootVerification.keyId) throw new Error("REJECT_LU_EXECUTION_AUTHORITY_ROOT_TRUST");
  const rootAttestation = root.attestation;
  if (!rootAttestation || rootAttestation.signer !== root.payload.root_key_id || rootAttestation.subjectDigest !== root.content_hash.value || rootAttestation.predicateType !== ROOT_PREDICATE || JSON.stringify(rootAttestation.predicate) !== JSON.stringify(rootPredicate(root)) || !(await verifyArtifactAttestation(rootAttestation, args.rootVerification))) throw new Error("REJECT_LU_EXECUTION_AUTHORITY_ROOT_SIGNATURE");
  const issuerAttestation = issuer.attestation;
  if (!issuerAttestation || issuerAttestation.signer !== root.payload.root_key_id || issuerAttestation.subjectDigest !== issuer.content_hash.value || issuerAttestation.predicateType !== ISSUER_PREDICATE || JSON.stringify(issuerAttestation.predicate) !== JSON.stringify(issuerPredicate(issuer)) || !(await verifyArtifactAttestation(issuerAttestation, args.rootVerification))) throw new Error("REJECT_LU_EXECUTION_AUTHORITY_ISSUER_SIGNATURE");
  return issuer;
}
