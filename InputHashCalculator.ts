import { HashDescriptor, RegistryReference } from '../types';
import { Canonicalizer } from '../canonical/RFC8785Canonicalizer';
import { CanonicalizationProfile } from '../canonical/CanonicalizationProfile';
import { HashEngine } from '../crypto/HashEngine';
import { CanonicalIdentityEnvelope } from './CanonicalIdentityEnvelope';

export interface InputHashCalculator {
  calculate(envelope: CanonicalIdentityEnvelope): Promise<HashDescriptor>;
}

export class DefaultInputHashCalculator implements InputHashCalculator {
  constructor(
    private canonicalizer: Canonicalizer,
    private profile: CanonicalizationProfile,
    private hashEngine: HashEngine,
  ) {}

  async calculate(envelope: CanonicalIdentityEnvelope): Promise<HashDescriptor> {
    // Ensure the envelope itself is canonicalized before hashing
    const bytes = this.canonicalizer.serialize(
      { ...envelope, input_hash: undefined }, // Exclude input_hash itself from calculation
      this.profile,
    );
    return this.hashEngine.hash(bytes, 'sha256-v1'); // Use a consistent algorithm
  }
}
