import { createPrivateKey, createPublicKey, sign, verify, generateKeyPairSync } from 'node:crypto';
import type {
  SignatureEnvelope,
  SigningKeyProvider,
  VerificationKeyProvider,
} from './SignatureEnvelope';

/**
 * P2-SR-VERIFY-ONLY-01 — Ed25519 verification WITHOUT minting capability.
 *
 * Holds a public key and nothing else. There is no `sign` method to disable, no private key to
 * omit and no branch that could be reached with signing material present: the capability is
 * absent by construction rather than refused at runtime.
 *
 * A `sign()` that throws would have been weaker in a way that matters. It keeps the method on
 * the type, so a consumer can still be written to call it, and the failure only appears when
 * that path executes. Here the failure is a compile error at the call site.
 *
 * Verification logic is deliberately identical to `LocalPemSigningKeyProvider.verify`, so a
 * signature accepted by one is accepted by the other. Two verifiers that could disagree would
 * be a second authority model.
 */
export class LocalPemVerificationKeyProvider implements VerificationKeyProvider {
  constructor(
    readonly keyId: string,
    private readonly publicKeyPem: string,
  ) {}

  async verify(payload: Uint8Array, signature: SignatureEnvelope): Promise<boolean> {
    if (signature.algorithm !== 'Ed25519') return false;
    if (!signature.signature.startsWith('ed25519:')) return false;
    const key = createPublicKey(this.publicKeyPem);
    const sig = Buffer.from(signature.signature.slice('ed25519:'.length), 'base64');
    try {
      return verify(null, Buffer.from(payload), key, sig);
    } catch {
      return false;
    }
  }
}

/**
 * Local Ed25519 PEM implementation of SigningKeyProvider (dev/test).
 * Production: GCP KMS / HSM behind the same interface.
 */
export class LocalPemSigningKeyProvider implements SigningKeyProvider {
  constructor(
    readonly keyId: string,
    private readonly privateKeyPem: string,
    private readonly publicKeyPem: string,
  ) {}

  static generate(keyId = 'ed25519:local'): {
    provider: LocalPemSigningKeyProvider;
    publicKey: string;
    privateKey: string;
  } {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    return {
      provider: new LocalPemSigningKeyProvider(keyId, privateKeyPem, publicKeyPem),
      publicKey: publicKeyPem,
      privateKey: privateKeyPem,
    };
  }

  async sign(payload: Uint8Array): Promise<SignatureEnvelope> {
    const key = createPrivateKey(this.privateKeyPem);
    const sig = sign(null, Buffer.from(payload), key);
    return {
      algorithm: 'Ed25519',
      digestAlgorithm: 'sha256',
      canonicalization: 'RFC8785',
      keyId: this.keyId,
      signature: `ed25519:${sig.toString('base64')}`,
      timestamp: Date.now(),
    };
  }

  async verify(payload: Uint8Array, signature: SignatureEnvelope): Promise<boolean> {
    if (signature.algorithm !== 'Ed25519') return false;
    if (!signature.signature.startsWith('ed25519:')) return false;
    const key = createPublicKey(this.publicKeyPem);
    const sig = Buffer.from(signature.signature.slice('ed25519:'.length), 'base64');
    try {
      return verify(null, Buffer.from(payload), key, sig);
    } catch {
      return false;
    }
  }
}

export type {
  SignatureEnvelope,
  SigningKeyProvider,
  VerificationKeyProvider,
  ArtifactAttestation,
} from './SignatureEnvelope';
