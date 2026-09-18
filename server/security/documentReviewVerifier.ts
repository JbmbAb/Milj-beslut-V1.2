import {
  LocalPemVerificationKeyProvider,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import {
  DOCUMENT_FACT_REVIEW_ACTION,
  DOCUMENT_FACT_REVIEW_PREDICATE_TYPE,
  DOCUMENT_PROPERTY_REVIEW_ACTION,
  DOCUMENT_PROPERTY_REVIEW_PREDICATE_TYPE,
  type DocumentReviewSignerPredicate,
} from '../../packages/mps-data-governance/src/DocumentReviewAuthority';

type VerifierConfig = Readonly<{
  readonly action: string;
  readonly predicateType: string;
  readonly publicKeyEnv: string;
  readonly keyIdEnv: string;
  readonly defaultKeyId: string;
}>;

const FACT_REVIEW: VerifierConfig = {
  action: DOCUMENT_FACT_REVIEW_ACTION,
  predicateType: DOCUMENT_FACT_REVIEW_PREDICATE_TYPE,
  publicKeyEnv: 'DOCUMENT_FACT_REVIEW_PUBLIC_KEY_PEM',
  keyIdEnv: 'DOCUMENT_FACT_REVIEW_SIGNER_KEY_ID',
  defaultKeyId: 'ed25519:document-fact-review-v1',
};

const PROPERTY_REVIEW: VerifierConfig = {
  action: DOCUMENT_PROPERTY_REVIEW_ACTION,
  predicateType: DOCUMENT_PROPERTY_REVIEW_PREDICATE_TYPE,
  publicKeyEnv: 'DOCUMENT_PROPERTY_REVIEW_PUBLIC_KEY_PEM',
  keyIdEnv: 'DOCUMENT_PROPERTY_REVIEW_SIGNER_KEY_ID',
  defaultKeyId: 'ed25519:document-property-review-v1',
};

export class DocumentReviewAuthorityRejected extends Error {
  constructor(reason: string) { super(`FAIL_CLOSED: ${reason}`); this.name = 'DocumentReviewAuthorityRejected'; }
}

function verifier(config: VerifierConfig, env: NodeJS.ProcessEnv): VerificationKeyProvider {
  const publicKey = env[config.publicKeyEnv]?.trim();
  if (!publicKey) throw new DocumentReviewAuthorityRejected(`${config.publicKeyEnv} is required`);
  return new LocalPemVerificationKeyProvider(env[config.keyIdEnv]?.trim() || config.defaultKeyId, publicKey);
}

export function getDocumentFactReviewVerifier(env: NodeJS.ProcessEnv = process.env): VerificationKeyProvider {
  return verifier(FACT_REVIEW, env);
}

export function getDocumentPropertyReviewVerifier(env: NodeJS.ProcessEnv = process.env): VerificationKeyProvider {
  return verifier(PROPERTY_REVIEW, env);
}

async function verify(
  attestation: ArtifactAttestation,
  config: VerifierConfig,
  verification: VerificationKeyProvider,
): Promise<void> {
  const predicate = attestation?.predicate as Partial<DocumentReviewSignerPredicate> | undefined;
  if (attestation?.predicateType !== config.predicateType) {
    throw new DocumentReviewAuthorityRejected(`predicate type is not ${config.action}`);
  }
  if (predicate?.action !== config.action) {
    throw new DocumentReviewAuthorityRejected(`attestation action is not ${config.action}`);
  }
  if (attestation.signer !== verification.keyId || predicate.signer_key_id !== verification.keyId) {
    throw new DocumentReviewAuthorityRejected(`signer is not trusted for ${config.action}`);
  }
  if (!(await verifyArtifactAttestation(attestation, verification))) {
    throw new DocumentReviewAuthorityRejected('signature verification failed');
  }
}

export async function verifyDocumentFactReviewSigner(
  attestation: ArtifactAttestation,
  verification: VerificationKeyProvider = getDocumentFactReviewVerifier(),
): Promise<void> {
  await verify(attestation, FACT_REVIEW, verification);
}

export async function verifyDocumentPropertyReviewSigner(
  attestation: ArtifactAttestation,
  verification: VerificationKeyProvider = getDocumentPropertyReviewVerifier(),
): Promise<void> {
  await verify(attestation, PROPERTY_REVIEW, verification);
}
