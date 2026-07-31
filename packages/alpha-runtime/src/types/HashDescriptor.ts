export interface HashDescriptor {
  readonly algorithm: string;
  readonly digest: string;
  readonly length?: number;
  readonly encoding?: string;
  readonly version?: string;
}

export class HashDescriptors {
  static equals(a: HashDescriptor, b: HashDescriptor): boolean {
    return (
      a.algorithm === b.algorithm &&
      a.digest.toLowerCase() === b.digest.toLowerCase()
    );
  }
}
