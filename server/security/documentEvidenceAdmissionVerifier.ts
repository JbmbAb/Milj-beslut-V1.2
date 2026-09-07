import {
  verifyArtifactAttestation,
  LocalPemVerificationKeyProvider,
  type ArtifactAttestation,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';
import {
  DOCUMENT_EVIDENCE_ADMISSION_ACTION,
  DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
  type DocumentEvidenceAdmissionPredicate,
} from '../../packages/mps-data-governance/src/DocumentEvidenceAdmission';

const PUBLIC_KEY_ENV = 'DOCUMENT_EVIDENCE_ADMISSION_PUBLIC_KEY_PEM';
const KEY_ID_ENV = 'DOCUMENT_EVIDENCE_ADMISSION_SIGNER_KEY_ID';
const DEFAULT_KEY_ID = 'ed25519:document-evidence-admission-v1';

export class DocumentEvidenceAdmissionAuthorityRejected extends Error {
  constructor(reason: string) { super(`FAIL_CLOSED: ${reason}`); this.name = 'DocumentEvidenceAdmissionAuthorityRejected'; }
}

/** Public-only trust root for exactly document_evidence.admit, not quarantine.promote. */
export function getDocumentEvidenceAdmissionVerifier(env: NodeJS.ProcessEnv = process.env): VerificationKeyProvider {
  const publicKey = env[PUBLIC_KEY_ENV]?.trim();
  if (!publicKey) throw new DocumentEvidenceAdmissionAuthorityRejected(`${PUBLIC_KEY_ENV} is required`);
  return new LocalPemVerificationKeyProvider(env[KEY_ID_ENV]?.trim() || DEFAULT_KEY_ID, publicKey);
}

/**
 * Verifies the action-scoped signer boundary only. Evidence/ref/actor bindings remain the
 * responsibility of DOCUMENT-EVIDENCE-V2-PRODUCTION-ADMISSION-BRIDGE-01.
 */
export async function verifyDocumentEvidenceAdmissionSigner(
  attestation: ArtifactAttestation,
  verification: VerificationKeyProvider = getDocumentEvidenceAdmissionVerifier(),
): Promise<void> {
  const predicate = attestation?.predicate as Partial<DocumentEvidenceAdmissionPredicate> | undefined;
  if (attestation?.predicateType !== DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE) {
    throw new DocumentEvidenceAdmissionAuthorityRejected('predicate type is not document-evidence admission');
  }
  if (predicate?.action !== DOCUMENT_EVIDENCE_ADMISSION_ACTION) {
    throw new DocumentEvidenceAdmissionAuthorityRejected('attestation action is not document_evidence.admit');
  }
  if (attestation.signer !== verification.keyId || predicate.signer_key_id !== verification.keyId) {
    throw new DocumentEvidenceAdmissionAuthorityRejected('signer is not trusted for document_evidence.admit');
  }
  if (!(await verifyArtifactAttestation(attestation, verification))) {
    throw new DocumentEvidenceAdmissionAuthorityRejected('signature verification failed');
  }
}
