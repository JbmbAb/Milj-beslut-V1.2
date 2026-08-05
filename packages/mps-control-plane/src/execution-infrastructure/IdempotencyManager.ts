/**
 * Maps idempotency keys → ticket_id for duplicate-safe enqueue.
 */
export interface IdempotencyStore {
  get(key: string): Promise<string | null>;
  put(key: string, ticket_id: string): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async put(key: string, ticket_id: string): Promise<void> {
    if (!this.map.has(key)) {
      this.map.set(key, ticket_id);
    }
  }
}

export class IdempotencyManager {
  constructor(private readonly store: IdempotencyStore = new MemoryIdempotencyStore()) {}

  async resolveExisting(key: string): Promise<string | null> {
    return this.store.get(key);
  }

  async remember(key: string, ticket_id: string): Promise<void> {
    await this.store.put(key, ticket_id);
  }
}
