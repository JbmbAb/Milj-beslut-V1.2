export interface AttemptCounterStore {
  get(ticket_id: string): Promise<number>;
  increment(ticket_id: string): Promise<number>;
}

export class MemoryAttemptCounterStore implements AttemptCounterStore {
  private readonly counts = new Map<string, number>();

  async get(ticket_id: string): Promise<number> {
    return this.counts.get(ticket_id) ?? 0;
  }

  async increment(ticket_id: string): Promise<number> {
    const next = (await this.get(ticket_id)) + 1;
    this.counts.set(ticket_id, next);
    return next;
  }
}
