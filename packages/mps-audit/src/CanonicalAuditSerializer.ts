import type { AuditRecord } from "./AuditTypes";

export interface CanonicalAuditSerializer {
  serialize(record: AuditRecord): Uint8Array;
}

// Implementation should delegate to the same canonical binary serializer
// used by MPS Core (e.g. canonical CBOR / protobuf / custom).
export class CoreCanonicalAuditSerializer implements CanonicalAuditSerializer {
  serialize(record: AuditRecord): Uint8Array {
    // placeholder – in verklig kod: använd MPS Core canonical serializer
    const json = JSON.stringify(record);
    return new TextEncoder().encode(json);
  }
}
