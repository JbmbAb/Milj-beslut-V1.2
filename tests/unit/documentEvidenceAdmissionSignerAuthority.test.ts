import { afterEach, describe, expect, it } from 'vitest';
import { LocalPemSigningKeyProvider, createArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import { DOCUMENT_EVIDENCE_ADMISSION_ACTION, DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE } from '../../packages/mps-data-governance/src/DocumentEvidenceAdmission';
import { getDocumentEvidenceAdmissionVerifier, verifyDocumentEvidenceAdmissionSigner } from '../../server/security/documentEvidenceAdmissionVerifier';

const original = new Map<string, string | undefined>();
function set(name: string, value: string | undefined) { if (!original.has(name)) original.set(name, process.env[name]); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
afterEach(() => { for (const [name, value] of original) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } original.clear(); });

describe('document_evidence.admit signer authority', () => {
  async function attestation(signer: LocalPemSigningKeyProvider, action = DOCUMENT_EVIDENCE_ADMISSION_ACTION) {
    return createArtifactAttestation({
      subjectDigest: 'evidence-content-hash',
      predicateType: DOCUMENT_EVIDENCE_ADMISSION_PREDICATE_TYPE,
      predicate: { action, signer_key_id: signer.keyId },
      signing: signer,
    });
  }

  it('accepts only the action-scoped signer through public trust', async () => {
    const pair = LocalPemSigningKeyProvider.generate('ed25519:document-evidence-admission-v1');
    set('DOCUMENT_EVIDENCE_ADMISSION_SIGNER_KEY_ID', pair.provider.keyId);
    set('DOCUMENT_EVIDENCE_ADMISSION_PUBLIC_KEY_PEM', pair.publicKey);
    set('DOCUMENT_EVIDENCE_ADMISSION_PRIVATE_KEY_PEM', undefined);
    await expect(verifyDocumentEvidenceAdmissionSigner(await attestation(pair.provider), getDocumentEvidenceAdmissionVerifier())).resolves.toBeUndefined();
  });

  it('denies quarantine signer, wrong action and wrong key material', async () => {
    const admission = LocalPemSigningKeyProvider.generate('ed25519:document-evidence-admission-v1');
    const quarantine = LocalPemSigningKeyProvider.generate('ed25519:governance-promotion-v1');
    set('DOCUMENT_EVIDENCE_ADMISSION_SIGNER_KEY_ID', admission.provider.keyId);
    set('DOCUMENT_EVIDENCE_ADMISSION_PUBLIC_KEY_PEM', admission.publicKey);
    const verifier = getDocumentEvidenceAdmissionVerifier();
    await expect(verifyDocumentEvidenceAdmissionSigner(await attestation(quarantine.provider), verifier)).rejects.toThrow(/not trusted/);
    await expect(verifyDocumentEvidenceAdmissionSigner(await attestation(admission.provider, 'quarantine.promote' as typeof DOCUMENT_EVIDENCE_ADMISSION_ACTION), verifier)).rejects.toThrow(/action/);
    const wrong = LocalPemSigningKeyProvider.generate('ed25519:document-evidence-admission-v1');
    await expect(verifyDocumentEvidenceAdmissionSigner(await attestation(wrong.provider), verifier)).rejects.toThrow(/signature verification failed/);
  });
});
