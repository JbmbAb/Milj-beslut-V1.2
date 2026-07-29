import type { CASRepository } from '../cas/CASRepository';
import { validateDescriptor, type CASDescriptor } from './Manifest';

/**
 * Result of sealing a payload into CAS as an OCI-style descriptor.
 * {@link DescriptorFactory} is the sole creator of new CASDescriptors from payloads.
 */
export interface StoredDescriptor extends CASDescriptor {
  readonly existed: boolean;
}

/**
 * Sole factory for CASDescriptor creation (ADR-042 / Fas 4 M2).
 * Domain code must not assemble `{ digest, size, mediaType }` by hand.
 */
export class DescriptorFactory {
  constructor(readonly cas: CASRepository) {}

  /**
   * Canonicalize + put into CAS, return a validated descriptor.
   * `mediaType` is stamped by the caller (ManifestBuilder supplies component types).
   */
  async store(payload: unknown, mediaType: string): Promise<StoredDescriptor> {
    if (payload === undefined) {
      throw new TypeError('DescriptorFactory.store: payload must not be undefined.');
    }
    if (typeof mediaType !== 'string' || mediaType.trim().length === 0) {
      throw new TypeError('DescriptorFactory.store: mediaType must be a non-empty string.');
    }

    const { hash, size, existed } = await this.cas.putCanonical(payload);
    const descriptor = validateDescriptor({
      mediaType,
      digest: hash,
      size,
    });

    return {
      mediaType: descriptor.mediaType,
      digest: descriptor.digest,
      size: descriptor.size,
      existed,
    };
  }
}
