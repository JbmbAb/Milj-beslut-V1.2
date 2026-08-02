export type CanonicalFormat = "JSON" | "CBOR";

export interface HashDescriptor {
    algorithm: "blake3";
    digest: string;
    encoding: "hex";
    version: string;
    length: number;
}

export interface CanonicalArtifact<T> {
    value: T;
    bytes: Uint8Array;
    content_hash: HashDescriptor;
}
