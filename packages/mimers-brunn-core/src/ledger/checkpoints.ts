import type { HashAlgorithmId, SignatureAlgorithmId } from '../serialization/algorithms';
import type { SignatureEnvelope } from '../signing/SignatureEnvelope';

/**
 * Independent Merkle verification layers (ADR-042):
 * CAS Merkle → Ledger Merkle → Checkpoint → Signed Checkpoint
 */
export interface CasMerkleCheckpoint {
  readonly kind: 'cas-merkle-checkpoint';
  readonly schemaVersion: 'checkpoint.cas.v1';
  readonly rootHash: string;
  readonly hashAlgorithm: HashAlgorithmId;
  readonly objectCount: number;
  readonly createdAt: string;
}

export interface LedgerMerkleCheckpoint {
  readonly kind: 'ledger-merkle-checkpoint';
  readonly schemaVersion: 'checkpoint.ledger.v1';
  readonly rootHash: string;
  readonly hashAlgorithm: HashAlgorithmId;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly eventCount: number;
  readonly createdAt: string;
}

export interface IntegrityCheckpoint {
  readonly kind: 'integrity-checkpoint';
  readonly schemaVersion: 'checkpoint.v1';
  readonly cas: CasMerkleCheckpoint;
  readonly ledger: LedgerMerkleCheckpoint;
  readonly createdAt: string;
}

export interface SignedCheckpoint {
  readonly kind: 'signed-checkpoint';
  readonly schemaVersion: 'checkpoint.signed.v1';
  readonly checkpoint: IntegrityCheckpoint;
  /** Digest of canonicalize(checkpoint) */
  readonly checkpointDigest: string;
  readonly hashAlgorithm: HashAlgorithmId;
  readonly signatureAlgorithm: SignatureAlgorithmId;
  readonly envelope: SignatureEnvelope;
}
