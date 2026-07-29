import crypto from 'node:crypto';
import { canonicalize } from './canonicalize';
import { stripEnvelope } from '../artifact/aes';

/**
 * AES-1.0 signing: Ed25519 over canonicalize(stripEnvelope(payload)).
 * Envelope fields never enter the signed bytes.
 */

export function signPayload(payload: Record<string, unknown>, privateKeyPemOrDerBase64: string): string {
  const stripped = stripEnvelope(payload);
  const bytes = Buffer.from(JSON.stringify(canonicalize(stripped)), 'utf8');
  const key = loadPrivateKey(privateKeyPemOrDerBase64);
  const sig = crypto.sign(null, bytes, key);
  return `ed25519:${sig.toString('base64')}`;
}

export function verifySignature(
  payload: Record<string, unknown>,
  signature: string | undefined,
  publicKeyPemOrDerBase64: string,
): boolean {
  if (!signature || !signature.startsWith('ed25519:')) return false;
  const stripped = stripEnvelope(payload);
  const bytes = Buffer.from(JSON.stringify(canonicalize(stripped)), 'utf8');
  const sig = Buffer.from(signature.slice('ed25519:'.length), 'base64');
  const key = loadPublicKey(publicKeyPemOrDerBase64);
  try {
    return crypto.verify(null, bytes, key, sig);
  } catch {
    return false;
  }
}

export function generateAesKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function loadPrivateKey(material: string): crypto.KeyObject {
  if (material.includes('BEGIN')) {
    return crypto.createPrivateKey(material);
  }
  return crypto.createPrivateKey({
    key: Buffer.from(material, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

function loadPublicKey(material: string): crypto.KeyObject {
  if (material.includes('BEGIN')) {
    return crypto.createPublicKey(material);
  }
  return crypto.createPublicKey({
    key: Buffer.from(material, 'base64'),
    format: 'der',
    type: 'spki',
  });
}
