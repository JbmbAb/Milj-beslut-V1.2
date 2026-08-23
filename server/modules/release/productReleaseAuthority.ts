import { createArtifactAttestation, verifyArtifactAttestation, type SigningKeyProvider, type VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import { PRODUCT_RELEASE_ISSUER_PURPOSE, productReleaseSubjectDigest, type ProductReleaseIssuerArtifact, type ProductReleaseManifestArtifact } from "../../../packages/mps-governance/src/release/ProductReleaseAuthority.js";

const PREDICATE = "product-release-authority-v1";
function predicate(issuer: ProductReleaseIssuerArtifact, release: ProductReleaseManifestArtifact) { return { action: "ISSUE_PRODUCT_RELEASE", issuer_purpose: PRODUCT_RELEASE_ISSUER_PURPOSE, artifact_type: release.artifact_type, release_hash: release.release_hash.value }; }
export async function attestProductRelease(args: { release: ProductReleaseManifestArtifact; issuer: ProductReleaseIssuerArtifact; signing: SigningKeyProvider }) {
  if (args.signing.keyId !== args.issuer.payload.key_id) throw new Error("REJECT_PRODUCT_RELEASE_ISSUER_KEY");
  return createArtifactAttestation({ subjectDigest: productReleaseSubjectDigest(args.release), predicateType: PREDICATE, predicate: predicate(args.issuer, args.release), signing: args.signing });
}
export async function verifyProductRelease(args: { release: ProductReleaseManifestArtifact; artifactRepository: ArtifactRepositoryPort; verification: VerificationKeyProvider }): Promise<void> {
  const issuer = await args.artifactRepository.resolve<ProductReleaseIssuerArtifact>(args.release.payload.issuer_ref);
  if (issuer.artifact_type !== "product_release_issuer" || issuer.payload.purpose !== PRODUCT_RELEASE_ISSUER_PURPOSE || issuer.payload.key_id !== args.verification.keyId) throw new Error("REJECT_PRODUCT_RELEASE_ISSUER_TRUST");
  const attestation = args.release.attestation;
  if (!attestation || attestation.signer !== issuer.payload.key_id || attestation.subjectDigest !== productReleaseSubjectDigest(args.release) || attestation.predicateType !== PREDICATE || JSON.stringify(attestation.predicate) !== JSON.stringify(predicate(issuer, args.release))) throw new Error("REJECT_PRODUCT_RELEASE_ATTESTATION");
  if (!(await verifyArtifactAttestation(attestation, args.verification))) throw new Error("REJECT_PRODUCT_RELEASE_SIGNATURE");
}
