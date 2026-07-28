import crypto from 'node:crypto';
import type { ArtifactStore } from '../artifact/ArtifactStore';
import { hashArtifact } from '../utils/hashArtifact';

export type EvolutionEventType =
  | 'RUN_STARTED'
  | 'CANDIDATE_GENERATED'
  | 'SHADOW_COMPLETED'
  | 'EXPERIMENT_RECORDED'
  | 'PROMOTION_CREATED'
  | 'PROMOTION_APPROVED'
  | 'PROMOTION_REJECTED';

export interface EvolutionEvent {
  readonly seq: number;
  readonly id: string;
  readonly type: EvolutionEventType;
  readonly timestamp: number;
  readonly runId?: string;
  readonly artifactId?: string;
  readonly payloadHash?: string;
  readonly prevEventHash?: string | null;
  readonly eventHash: string;
}

export class EventLedger {
  private seq = 0;
  private lastHash: string | null = null;
  private loaded = false;

  constructor(
    private readonly store: ArtifactStore,
    private readonly runId?: string,
  ) {}

  async record(
    event: Omit<EvolutionEvent, 'seq' | 'id' | 'timestamp' | 'eventHash' | 'prevEventHash'>,
  ): Promise<EvolutionEvent> {
    await this.loadState();

    const timestamp = Date.now();
    const seq = this.seq + 1;
    const payload = {
      seq,
      id: `${event.type}-${timestamp}-${crypto.randomUUID()}`,
      type: event.type,
      timestamp,
      runId: event.runId,
      artifactId: event.artifactId,
      payloadHash: event.payloadHash,
      prevEventHash: this.lastHash,
    };
    const full: EvolutionEvent = {
      ...payload,
      eventHash: hashArtifact(payload),
    };

    await this.store.put(this.eventKey(seq), full);
    this.seq = seq;
    this.lastHash = full.eventHash;
    return full;
  }

  private async loadState(): Promise<void> {
    if (this.loaded) return;

    const events = await this.store.list(this.eventPrefix());
    if (events.length === 0) {
      this.loaded = true;
      return;
    }

    const seqs = events
      .map((key) => Number.parseInt(key.split('/').pop() ?? '', 10))
      .filter((seq) => Number.isFinite(seq));

    if (seqs.length > 0) {
      this.seq = Math.max(...seqs);
      const last = await this.store.get<EvolutionEvent>(this.eventKey(this.seq));
      this.lastHash = last?.eventHash ?? null;
    }

    this.loaded = true;
  }

  private eventPrefix(): string {
    return `event/${this.runId ?? 'global'}`;
  }

  private eventKey(seq: number): string {
    return `${this.eventPrefix()}/${seq.toString().padStart(6, '0')}`;
  }
}
