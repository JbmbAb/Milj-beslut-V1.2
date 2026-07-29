import { createHash } from 'node:crypto';
import { canonicalizeStrict, hashCanonicalValue, hashSerialized } from '../serialization';
import type { SigningKeyProvider } from '../signing/SignatureEnvelope';
import type {
  CasMerkleCheckpoint,
  IntegrityCheckpoint,
  LedgerMerkleCheckpoint,
  SignedCheckpoint,
} from './checkpoints';
import { MerkleTree, type MimersLedgerEvent } from './Merkle';

/** Build a ledger Merkle checkpoint over an inclusive event range (P2A). */
export function buildLedgerMerkleCheckpoint(
  events: readonly MimersLedgerEvent[],
): LedgerMerkleCheckpoint {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const rootHash = MerkleTree.computeEventRoot(sorted);
  return {
    kind: 'ledger-merkle-checkpoint',
    schemaVersion: 'checkpoint.ledger.v1',
    rootHash,
    hashAlgorithm: 'sha256',
    fromSequence: sorted[0]?.sequence ?? 0,
    toSequence: sorted[sorted.length - 1]?.sequence ?? 0,
    eventCount: sorted.length,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Build a CAS Merkle checkpoint from content-address digests (P2B).
 * Digests are sorted then merkle-folded independently of the ledger tree.
 */
export function buildCasMerkleCheckpoint(objectDigests: readonly string[]): CasMerkleCheckpoint {
  const sorted = [...objectDigests].sort();
  const rootHash =
    sorted.length === 0
      ? hashSerialized('mimers-cas-merkle-empty-v1', 'sha256')
      : foldDigestMerkle(sorted);

  return {
    kind: 'cas-merkle-checkpoint',
    schemaVersion: 'checkpoint.cas.v1',
    rootHash,
    hashAlgorithm: 'sha256',
    objectCount: sorted.length,
    createdAt: new Date().toISOString(),
  };
}

function foldDigestMerkle(sortedDigests: readonly string[]): string {
  let level = sortedDigests.map((digest) => {
    const hex = digest.includes(':') ? digest.slice(digest.indexOf(':') + 1) : digest;
    const hashStream = createHash('sha256');
    hashStream.update(Buffer.from([0x00]));
    hashStream.update(Buffer.from('mimers-cas-object-v1\0', 'utf-8'));
    hashStream.update(Buffer.from(hex, 'hex'));
    return `sha256:${hashStream.digest('hex')}`;
  });

  const nodePrefix = Buffer.from([0x01]);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        const left = level[i]!.slice('sha256:'.length);
        const right = level[i + 1]!.slice('sha256:'.length);
        const hashStream = createHash('sha256');
        hashStream.update(nodePrefix);
        hashStream.update(Buffer.from(left, 'hex'));
        hashStream.update(Buffer.from(right, 'hex'));
        next.push(`sha256:${hashStream.digest('hex')}`);
      } else {
        next.push(level[i]!);
      }
    }
    level = next;
  }
  return level[0]!;
}

export function buildIntegrityCheckpoint(
  cas: CasMerkleCheckpoint,
  ledger: LedgerMerkleCheckpoint,
): IntegrityCheckpoint {
  return {
    kind: 'integrity-checkpoint',
    schemaVersion: 'checkpoint.v1',
    cas,
    ledger,
    createdAt: new Date().toISOString(),
  };
}

export async function signIntegrityCheckpoint(
  checkpoint: IntegrityCheckpoint,
  signing: SigningKeyProvider,
): Promise<SignedCheckpoint> {
  const checkpointDigest = hashCanonicalValue(checkpoint);
  const bytes = Buffer.from(canonicalizeStrict(checkpoint), 'utf-8');
  const envelope = await signing.sign(bytes);
  return {
    kind: 'signed-checkpoint',
    schemaVersion: 'checkpoint.signed.v1',
    checkpoint,
    checkpointDigest,
    hashAlgorithm: 'sha256',
    signatureAlgorithm: envelope.algorithm,
    envelope,
  };
}

export async function verifySignedCheckpoint(
  signed: SignedCheckpoint,
  signing: SigningKeyProvider,
): Promise<boolean> {
  const digest = hashCanonicalValue(signed.checkpoint);
  if (digest !== signed.checkpointDigest) return false;
  const bytes = Buffer.from(canonicalizeStrict(signed.checkpoint), 'utf-8');
  return signing.verify(bytes, signed.envelope);
}
