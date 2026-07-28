export interface MutationRecord {
  readonly id: string;
  readonly type: string;
  readonly description?: string;
  readonly params?: Record<string, unknown>;
  readonly createdAt?: number;
}
