import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { InfrastructureClock, ReplayScheduleJob } from "./types.js";

export interface ReplayJobStore {
  enqueue(job: ReplayScheduleJob): Promise<void>;
  /** Oldest pending job, or null. */
  dequeuePending(worker_id: string): Promise<ReplayScheduleJob | null>;
  complete(job_id: string): Promise<void>;
  fail(job_id: string): Promise<void>;
  listPending(): Promise<ReplayScheduleJob[]>;
}

export class MemoryReplayJobStore implements ReplayJobStore {
  private readonly jobs: ReplayScheduleJob[] = [];

  async enqueue(job: ReplayScheduleJob): Promise<void> {
    this.jobs.push(job);
  }

  async dequeuePending(worker_id: string): Promise<ReplayScheduleJob | null> {
    const idx = this.jobs.findIndex((j) => j.status === "pending");
    if (idx < 0) return null;
    const leased: ReplayScheduleJob = {
      ...this.jobs[idx],
      status: "leased",
      job_id: this.jobs[idx].job_id,
    };
    // stamp worker into job_id suffix is unnecessary; status leased is enough
    void worker_id;
    this.jobs[idx] = leased;
    return leased;
  }

  async complete(job_id: string): Promise<void> {
    const j = this.jobs.find((x) => x.job_id === job_id);
    if (j) Object.assign(j, { status: "completed" });
  }

  async fail(job_id: string): Promise<void> {
    const j = this.jobs.find((x) => x.job_id === job_id);
    if (j) Object.assign(j, { status: "failed" });
  }

  async listPending(): Promise<ReplayScheduleJob[]> {
    return this.jobs.filter((j) => j.status === "pending");
  }
}

/**
 * Schedules replay work without mutating domain logic or artifacts.
 * Replay execution is injected by the caller (ReplayEngine).
 */
export class ReplayScheduler {
  constructor(
    private readonly store: ReplayJobStore = new MemoryReplayJobStore(),
    private readonly clock: InfrastructureClock = { now: () => new Date() },
    private readonly idGen: () => string = () =>
      `replay-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  ) {}

  async schedule(input: {
    readonly manifest_ref: ArtifactReference;
    readonly attempt_ref?: ArtifactReference | null;
  }): Promise<ReplayScheduleJob> {
    const job: ReplayScheduleJob = {
      job_id: this.idGen(),
      manifest_ref: input.manifest_ref,
      attempt_ref: input.attempt_ref ?? null,
      scheduled_at: this.clock.now().toISOString(),
      status: "pending",
    };
    await this.store.enqueue(job);
    return job;
  }

  async next(worker_id: string): Promise<ReplayScheduleJob | null> {
    return this.store.dequeuePending(worker_id);
  }

  async complete(job_id: string): Promise<void> {
    await this.store.complete(job_id);
  }

  async fail(job_id: string): Promise<void> {
    await this.store.fail(job_id);
  }

  async pendingCount(): Promise<number> {
    return (await this.store.listPending()).length;
  }
}
