import { HashDescriptor, RegistryReference, ProvenanceGraph, SignatureDescriptor } from "../types";

export interface RegistryEntry {
  reference: RegistryReference;
  content: unknown;
  signature?: SignatureDescriptor;
  provenance: ProvenanceGraph;
  lifecycle: {
    state: "draft" | "admitted" | "promoted" | "deprecated";
    transition_history: RegistryReference[];
  };
  metadata?: Record<string, unknown>;
}

export interface RegistryStore {
  get(reference: RegistryReference): Promise<RegistryEntry | null>;
  getByHash(hash: HashDescriptor): Promise<RegistryEntry | null>;
  put(entry: RegistryEntry): Promise<void>;
  exists(reference: RegistryReference): Promise<boolean>;
}

export class InMemoryRegistryStore implements RegistryStore {
  private byRef = new Map<string, RegistryEntry>();
  private byHash = new Map<string, RegistryEntry>();

  private refKey(ref: RegistryReference): string {
    return `${ref.id}@${ref.version}`;
  }

  private hashKey(hash: HashDescriptor): string {
    return `${hash.algorithm}:${hash.digest}`;
  }

  async get(reference: RegistryReference): Promise<RegistryEntry | null> {
    const key = this.refKey(reference);
    const entry = this.byRef.get(key) ?? null;
    if (!entry) return null;

    const storedHashKey = this.hashKey(entry.reference.content_hash);
    const refHashKey = this.hashKey(reference.content_hash);
    if (storedHashKey !== refHashKey) return null;

    return entry;
  }

  async getByHash(hash: HashDescriptor): Promise<RegistryEntry | null> {
    const hk = this.hashKey(hash);
    return this.byHash.get(hk) ?? null;
  }

  async put(entry: RegistryEntry): Promise<void> {
    const hk = this.hashKey(entry.reference.content_hash);

    if (this.byHash.has(hk)) {
      const existing = this.byHash.get(hk)!;
      if (JSON.stringify(existing.content) !== JSON.stringify(entry.content)) {
        throw new Error("Hash collision detected");
      }
      // same content already stored; ensure ref mapping exists
      const rk = this.refKey(entry.reference);
      this.byRef.set(rk, existing);
      return;
    }

    const rk = this.refKey(entry.reference);
    this.byRef.set(rk, entry);
    this.byHash.set(hk, entry);
  }

  async exists(reference: RegistryReference): Promise<boolean> {
    const key = this.refKey(reference);
    const entry = this.byRef.get(key);
    if (!entry) return false;
    const storedHashKey = this.hashKey(entry.reference.content_hash);
    const refHashKey = this.hashKey(reference.content_hash);
    return storedHashKey === refHashKey;
  }
}
