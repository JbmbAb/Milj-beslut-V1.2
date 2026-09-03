import { LocalPemSigningKeyProvider, type SigningKeyProvider } from '@miljobeslut/mimers-brunn-core';

type SignerConfig = Readonly<{
  readonly action: string;
  readonly privateKeyEnv: string;
  readonly publicKeyEnv: string;
  readonly keyIdEnv: string;
  readonly defaultKeyId: string;
}>;

const FACT_REVIEW: SignerConfig = {
  action: 'document_fact.review',
  privateKeyEnv: 'DOCUMENT_FACT_REVIEW_PRIVATE_KEY_PEM',
  publicKeyEnv: 'DOCUMENT_FACT_REVIEW_PUBLIC_KEY_PEM',
  keyIdEnv: 'DOCUMENT_FACT_REVIEW_SIGNER_KEY_ID',
  defaultKeyId: 'ed25519:document-fact-review-v1',
};

const PROPERTY_REVIEW: SignerConfig = {
  action: 'document_evidence.property_review',
  privateKeyEnv: 'DOCUMENT_PROPERTY_REVIEW_PRIVATE_KEY_PEM',
  publicKeyEnv: 'DOCUMENT_PROPERTY_REVIEW_PUBLIC_KEY_PEM',
  keyIdEnv: 'DOCUMENT_PROPERTY_REVIEW_SIGNER_KEY_ID',
  defaultKeyId: 'ed25519:document-property-review-v1',
};

function signer(config: SignerConfig, env: NodeJS.ProcessEnv): SigningKeyProvider {
  const privateKey = env[config.privateKeyEnv]?.trim();
  const publicKey = env[config.publicKeyEnv]?.trim();
  if (!privateKey || !publicKey) {
    throw new Error(`REJECT_DOCUMENT_REVIEW_SIGNER_CONFIGURATION: ${config.action} requires ${config.privateKeyEnv} and ${config.publicKeyEnv}`);
  }
  return new LocalPemSigningKeyProvider(env[config.keyIdEnv]?.trim() || config.defaultKeyId, privateKey, publicKey);
}

/** Owner-side only; runtime readers use documentReviewVerifier.ts. */
export function getDocumentFactReviewSigningProvider(env: NodeJS.ProcessEnv = process.env): SigningKeyProvider {
  return signer(FACT_REVIEW, env);
}

/** Owner-side only; runtime readers use documentReviewVerifier.ts. */
export function getDocumentPropertyReviewSigningProvider(env: NodeJS.ProcessEnv = process.env): SigningKeyProvider {
  return signer(PROPERTY_REVIEW, env);
}
