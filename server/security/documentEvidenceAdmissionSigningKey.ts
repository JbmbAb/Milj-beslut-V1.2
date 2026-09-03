import { LocalPemSigningKeyProvider, type SigningKeyProvider } from '@miljobeslut/mimers-brunn-core';

const PRIVATE_KEY_ENV = 'DOCUMENT_EVIDENCE_ADMISSION_PRIVATE_KEY_PEM';
const PUBLIC_KEY_ENV = 'DOCUMENT_EVIDENCE_ADMISSION_PUBLIC_KEY_PEM';
const KEY_ID_ENV = 'DOCUMENT_EVIDENCE_ADMISSION_SIGNER_KEY_ID';
const DEFAULT_KEY_ID = 'ed25519:document-evidence-admission-v1';

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`REJECT_DOCUMENT_EVIDENCE_ADMISSION_SIGNER_CONFIGURATION: ${name} is required`);
  return value;
}

/** Owner-side only; the future admission bridge consumes the public-only verifier. */
export function getDocumentEvidenceAdmissionSigningProvider(env: NodeJS.ProcessEnv = process.env): SigningKeyProvider {
  return new LocalPemSigningKeyProvider(
    env[KEY_ID_ENV]?.trim() || DEFAULT_KEY_ID,
    required(env, PRIVATE_KEY_ENV),
    required(env, PUBLIC_KEY_ENV),
  );
}
