import { createHash } from 'crypto';

/**
 * CAS-I01: A CAS domain SHALL NOT derive identity from another CAS domain's mutable metadata.
 */

// --- DOCUMENT CAS ---

export interface DocumentIdentity {
  contentBytes: Buffer; // Raw canonical bytes of the document
}

export class DocumentCAS {
  static generateIdentityHash(identity: DocumentIdentity): string {
    return createHash('sha256').update(identity.contentBytes).digest('hex');
  }
}

// --- EMBEDDING CAS ---

export interface EmbeddingIdentity {
  chunkHash: string;      // Note: hash of chunk content, not dependent on mutable metadata
  embeddingModel: string;
  embeddingVersion: string;
  tokenizerVersion: string;
}

export class EmbeddingCAS {
  static generateIdentityHash(identity: EmbeddingIdentity): string {
    const combined = `${identity.chunkHash}||${identity.embeddingModel}||${identity.embeddingVersion}||${identity.tokenizerVersion}`;
    return createHash('sha256').update(combined).digest('hex');
  }
}
