import { KeyDescriptor } from '../types'; // Assuming KeyDescriptor is defined in types.ts

export interface KeyStore {
  getKey(keyId: string): Promise<KeyDescriptor | null>;
}

export class InMemoryKeyStore implements KeyStore {
  private keys = new Map<string, KeyDescriptor>();

  async getKey(keyId: string): Promise<KeyDescriptor | null> {
    return this.keys.get(keyId) ?? null;
  }
}
