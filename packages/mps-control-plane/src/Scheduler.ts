import type { Scheduler, PlanArtifact, Instant, SchedulerPolicyArtifact, ScheduledPlanArtifact } from "./types";
import { CanonicalSerializer } from "@miljobeslut/mps-canonical";
import * as crypto from "node:crypto";

export class DefaultScheduler implements Scheduler {
  constructor(
    private readonly serializer: CanonicalSerializer,
    private readonly schedulerHash: string = "hash-scheduler-v1"
  ) {}

  schedule(
    plan: PlanArtifact,
    instant: Instant,
    policy: SchedulerPolicyArtifact
  ): ScheduledPlanArtifact {
    // Contract: Scheduler SHALL be pure and deterministic
    const baseScheduled = {
      schema_version: "scheduled.plan.v1" as const,
      plan_hash: plan.plan_hash,
      scheduler_hash: this.schedulerHash,
      scheduler_policy_hash: policy.policy_hash,
      scheduled_at: instant,
      priority: "NORMAL" as const, // Bestäms av scheduleringspolicy/indata
    };

    const bytes = this.serializer.serialize(baseScheduled);
    const scheduled_hash = `sha256-${crypto.createHash("sha256").update(bytes).digest("hex")}`;

    return {
      ...baseScheduled,
      scheduled_hash,
    };
  }
}
