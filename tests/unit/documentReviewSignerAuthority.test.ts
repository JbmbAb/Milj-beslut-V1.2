import { afterEach, describe, expect, it } from 'vitest';
import { LocalPemSigningKeyProvider, createArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import {
  DOCUMENT_FACT_REVIEW_ACTION,
  DOCUMENT_FACT_REVIEW_PREDICATE_TYPE,
  DOCUMENT_PROPERTY_REVIEW_ACTION,
  DOCUMENT_PROPERTY_REVIEW_PREDICATE_TYPE,
} from '../../packages/mps-data-governance/src/DocumentReviewAuthority';
import {
  getDocumentFactReviewVerifier,
  getDocumentPropertyReviewVerifier,
  verifyDocumentFactReviewSigner,
  verifyDocumentPropertyReviewSigner,
} from '../../server/security/documentReviewVerifier';
import { getDocumentFactReviewSigningProvider } from '../../server/security/documentReviewSigningKey';

const original = new Map<string, string | undefined>();
function set(name: string, value: string | undefined) { if (!original.has(name)) original.set(name, process.env[name]); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
afterEach(() => { for (const [name, value] of original) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } original.clear(); });

async function attestation(
  signer: LocalPemSigningKeyProvider,
  action: string,
  predicateType: string,
) {
  return createArtifactAttestation({
    subjectDigest: 'reviewed-artifact-hash',
    predicateType,
    predicate: { action, signer_key_id: signer.keyId },
    signing: signer,
  });
}

describe('document review signer authority', () => {
  it('verifies each action through its own public-only trust root', async () => {
    const fact = LocalPemSigningKeyProvider.generate('ed25519:document-fact-review-v1');
    const property = LocalPemSigningKeyProvider.generate('ed25519:document-property-review-v1');
    set('DOCUMENT_FACT_REVIEW_SIGNER_KEY_ID', fact.provider.keyId);
    set('DOCUMENT_FACT_REVIEW_PUBLIC_KEY_PEM', fact.publicKey);
    set('DOCUMENT_FACT_REVIEW_PRIVATE_KEY_PEM', undefined);
    set('DOCUMENT_PROPERTY_REVIEW_SIGNER_KEY_ID', property.provider.keyId);
    set('DOCUMENT_PROPERTY_REVIEW_PUBLIC_KEY_PEM', property.publicKey);
    set('DOCUMENT_PROPERTY_REVIEW_PRIVATE_KEY_PEM', undefined);

    await expect(verifyDocumentFactReviewSigner(
      await attestation(fact.provider, DOCUMENT_FACT_REVIEW_ACTION, DOCUMENT_FACT_REVIEW_PREDICATE_TYPE),
      getDocumentFactReviewVerifier(),
    )).resolves.toBeUndefined();
    await expect(verifyDocumentPropertyReviewSigner(
      await attestation(property.provider, DOCUMENT_PROPERTY_REVIEW_ACTION, DOCUMENT_PROPERTY_REVIEW_PREDICATE_TYPE),
      getDocumentPropertyReviewVerifier(),
    )).resolves.toBeUndefined();
  });

  it('denies cross-action signers, wrong actions, wrong keys, and private-key-free signing attempts', async () => {
    const fact = LocalPemSigningKeyProvider.generate('ed25519:document-fact-review-v1');
    const property = LocalPemSigningKeyProvider.generate('ed25519:document-property-review-v1');
    set('DOCUMENT_FACT_REVIEW_SIGNER_KEY_ID', fact.provider.keyId);
    set('DOCUMENT_FACT_REVIEW_PUBLIC_KEY_PEM', fact.publicKey);
    set('DOCUMENT_FACT_REVIEW_PRIVATE_KEY_PEM', undefined);
    const factVerifier = getDocumentFactReviewVerifier();

    await expect(verifyDocumentFactReviewSigner(
      await attestation(property.provider, DOCUMENT_FACT_REVIEW_ACTION, DOCUMENT_FACT_REVIEW_PREDICATE_TYPE),
      factVerifier,
    )).rejects.toThrow(/not trusted|signature verification failed/);
    await expect(verifyDocumentFactReviewSigner(
      await attestation(fact.provider, DOCUMENT_PROPERTY_REVIEW_ACTION, DOCUMENT_FACT_REVIEW_PREDICATE_TYPE),
      factVerifier,
    )).rejects.toThrow(/action/);
    const wrongFact = LocalPemSigningKeyProvider.generate('ed25519:document-fact-review-v1');
    await expect(verifyDocumentFactReviewSigner(
      await attestation(wrongFact.provider, DOCUMENT_FACT_REVIEW_ACTION, DOCUMENT_FACT_REVIEW_PREDICATE_TYPE),
      factVerifier,
    )).rejects.toThrow(/signature verification failed/);
    expect(() => getDocumentFactReviewSigningProvider()).toThrow(/DOCUMENT_FACT_REVIEW_PRIVATE_KEY_PEM/);
  });
});
