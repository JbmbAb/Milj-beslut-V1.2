import { RegistryReference } from "../../types";

export interface CanonicalRegistryReference {
  readonly logical_id: string;
  readonly version: string;
  readonly content_hash: string;
}

export class RegistryReferenceCanonicalizer {
  static toCanonical(ref: RegistryReference): CanonicalRegistryReference {
    return {
      logical_id: ref.id,
      version: ref.version,
      content_hash: ref.content_hash.digest,
    };
  }

  static compare(a: CanonicalRegistryReference, b: CanonicalRegistryReference): number {
    const aKey = `${a.logical_id}@${a.version}@${a.content_hash}`;
    const bKey = `${b.logical_id}@${b.version}@${b.content_hash}`;
    return aKey.localeCompare(bKey);
  }
}
