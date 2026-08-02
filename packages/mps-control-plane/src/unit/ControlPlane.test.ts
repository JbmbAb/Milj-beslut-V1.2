import { describe, expect, it } from "vitest";
import {
  DefaultPlanBuilder,
  DefaultScheduler,
  DefaultExecutionQueue,
  DefaultExecutionContextFactory,
  AgentController,
} from "../index";
import type {
  PlannerInputArtifact,
  PlanArtifact,
  SchedulerPolicyArtifact,
  ExecutionQueueItem,
  WorkerIdentity,
  TenantControlPlaneContextArtifact,
  ScheduledPlanArtifact,
  ExecutionContext,
} from "../index";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";

// --- Mock Helpers ---

const mockClock = { now: () => new Date("2026-07-31T12:00:00.000Z") };
const mockIdGen = {
  counter: 0,
  generate() {
    this.counter += 1;
    return `id-${this.counter}`;
  },
};

const mockWorker: WorkerIdentity = {
  worker_id: "worker-1",
  runtime_identity: {
    runtime_schema_version: "r.v1",
    runtime_version: "1.0",
    runtime_hash: "hash-runtime",
  },
  capabilities: ["GOVERNANCE", "ARCHIVE"],
};

describe("Mimer Control Plane & Governance Layer Suite", () => {
  const serializer = new DefaultCanonicalPipeline();

  describe("DefaultPlanBuilder & DefaultScheduler (Pure Determinism)", () => {
    it("PlanBuilder should always build identical PlanArtifact given identical PlannerInputArtifact", () => {
      const builder = new DefaultPlanBuilder(serializer);

      const input: PlannerInputArtifact = {
        schema_version: "planner.input.v1",
        input_hash: "input-hash-1",
        pipeline_id: "pipe-1",
        pipeline_version: "1.0",
        registry_snapshot_id: "reg-snap-1",
        policy_set_id: "policy-set-1",
        pipeline_spec_hash: "spec-hash",
        registry_snapshot_hash: "snapshot-hash",
        policy_set_hash: "policy-hash",
        clock_instant: { iso8601: "2026-07-31T12:00:00.000Z" },
        pipeline_schema_version: "ps.v1",
        registry_schema_version: "rs.v1",
        policy_schema_version: "pos.v1",
      };

      const plan1 = builder.build(input);
      const plan2 = builder.build(input);

      expect(plan1).toEqual(plan2);
      expect(plan1.plan_hash).toBeDefined();
    });

    it("Scheduler should always produce identical ScheduledPlanArtifact", () => {
      const scheduler = new DefaultScheduler(serializer);

      const plan: PlanArtifact = {
        schema_version: "plan.artifact.v1",
        plan_hash: "hash-plan-123",
        planner_input_hash: "input-hash",
        pipeline_hash: "pipe-hash",
        registry_snapshot_hash: "reg-hash",
        policy_set_hash: "policy-hash",
        plan_id: "plan-1",
        plan_builder_version: "1.0",
        plan_builder_hash: "builder-hash",
        canonicalization_version: "v1",
        stages_order: ["GOVERNANCE"],
        created_at: { iso8601: "2026-07-31T12:00:00.000Z" },
      };

      const policy: SchedulerPolicyArtifact = {
        schema_version: "scheduler.policy.v1",
        policy_id: "policy-1",
        policy_hash: "hash-policy-123",
        priority_weights: { LOW: 1, NORMAL: 2, HIGH: 3 },
        tenant_quotas: {},
        aging_ms: 1000,
        burst_allowance: 10,
        fairness_algorithm: "WEIGHTED_FAIR_QUEUE",
      };

      const instant = { iso8601: "2026-07-31T12:00:00.000Z" };

      const sched1 = scheduler.schedule(plan, instant, policy);
      const sched2 = scheduler.schedule(plan, instant, policy);

      expect(sched1).toEqual(sched2);
      expect(sched1.scheduled_hash).toBeDefined();
    });
  });

  describe("ExecutionQueue (Priority & Lexicographical Determinism)", () => {
    it("should select lexicographically smallest plan_hash when priority, tenant, and scheduled_at are identical", () => {
      const idGen = {
        counter: 0,
        generate() {
          this.counter += 1;
          return `id-${this.counter}`;
        },
      };
      const queue = new DefaultExecutionQueue(serializer, mockClock, idGen);

      const item1: ExecutionQueueItem = {
        queue_item_id: "item-1",
        queue_item_hash: "hash-1",
        scheduled_hash: "sched-1",
        plan_hash: "plan-zzz-last", // Lexikografiskt sist
        tenant_id: "tenant-1",
        priority: "NORMAL",
        scheduled_at: { iso8601: "2026-07-31T12:00:00Z" },
      };

      const item2: ExecutionQueueItem = {
        queue_item_id: "item-2",
        queue_item_hash: "hash-2",
        scheduled_hash: "sched-2",
        plan_hash: "plan-aaa-first", // Lexikografiskt först
        tenant_id: "tenant-1",
        priority: "NORMAL",
        scheduled_at: { iso8601: "2026-07-31T12:00:00Z" },
      };

      queue.enqueue(item1);
      queue.enqueue(item2);

      const lease = queue.reserve(mockWorker);

      // Skall välja item2 pga lexikografiskt mindre plan_hash ("plan-aaa-first" < "plan-zzz-last")
      expect(lease!.item.queue_item_id).toBe("item-2");
    });

    it("should transition lease states cleanly (reserve -> heartbeat -> extendLease -> release)", () => {
      const idGen = {
        counter: 0,
        generate() {
          this.counter += 1;
          return `id-${this.counter}`;
        },
      };
      const queue = new DefaultExecutionQueue(serializer, mockClock, idGen);

      const item: ExecutionQueueItem = {
        queue_item_id: "item-1",
        queue_item_hash: "hash-1",
        scheduled_hash: "sched-1",
        plan_hash: "plan-1",
        tenant_id: "tenant-1",
        priority: "HIGH",
        scheduled_at: { iso8601: "2026-07-31T12:00:00Z" },
      };

      queue.enqueue(item);

      const lease = queue.reserve(mockWorker);
      expect(lease).not.toBeNull();
      expect(queue.getLeases()).toHaveLength(1);
      expect(queue.getLeaseEvents()).toHaveLength(1);
      expect(queue.getLeaseEvents()[0].schema_version).toBe("lease.issued.v1");

      queue.heartbeat(mockWorker, lease!.lease_id);
      expect(queue.getLeaseEvents()).toHaveLength(2);
      expect(queue.getLeaseEvents()[1].schema_version).toBe("lease.heartbeat.v1");

      queue.extendLease(mockWorker, lease!.lease_id, 10000);
      expect(queue.getLeaseEvents()).toHaveLength(3);
      expect(queue.getLeaseEvents()[2].schema_version).toBe("lease.extended.v1");

      queue.release(mockWorker, lease!.lease_id);
      expect(queue.getLeases()).toHaveLength(0);
      expect(queue.getLeaseEvents()).toHaveLength(4);
      expect(queue.getLeaseEvents()[3].schema_version).toBe("lease.released.v1");
    });
  });

  describe("AgentController Execution Integration", () => {
    it("should coordinate successfully from Plan to CompletedEvent", async () => {
      const mockRuntime = {
        executePipeline: async () => ({
          schema_version: "execution.report.v1" as const,
          report_hash: "hash-report",
          plan_hash: "hash-plan",
          scheduled_hash: "hash-sched",
          context_hash: "hash-ctx",
          tenant_id: "tenant-1",
          started_at: { iso8601: "2026-07-31T12:00:00Z" },
          finished_at: { iso8601: "2026-07-31T12:00:01Z" },
          success: true,
          details: {},
        }),
      };

      const mockEnforcement = {
        enforce: async () => {}, // mock pass
      };

      const factory = new DefaultExecutionContextFactory(serializer);
      const eventsReceived: any[] = [];
      const subscriber = {
        onExecutionCompleted: async (event: any) => {
          eventsReceived.push(event);
        },
      };

      const controller = new AgentController(
        mockRuntime,
        mockEnforcement,
        factory,
        [subscriber],
        serializer
      );

      const plan: PlanArtifact = {
        schema_version: "plan.artifact.v1",
        plan_hash: "hash-plan",
        planner_input_hash: "input-hash",
        pipeline_hash: "pipe-hash",
        registry_snapshot_hash: "reg-hash",
        policy_set_hash: "policy-hash",
        plan_id: "plan-1",
        plan_builder_version: "1.0",
        plan_builder_hash: "builder-hash",
        canonicalization_version: "v1",
        stages_order: ["GOVERNANCE"],
        created_at: { iso8601: "2026-07-31T12:00:00Z" },
      };

      const scheduled: ScheduledPlanArtifact = {
        schema_version: "scheduled.plan.v1",
        scheduled_hash: "hash-sched",
        plan_hash: "hash-plan",
        scheduler_hash: "sched-1",
        scheduler_policy_hash: "policy-hash",
        scheduled_at: { iso8601: "2026-07-31T12:00:00Z" },
        priority: "NORMAL",
      };

      const control: TenantControlPlaneContextArtifact = {
        schema_version: "tenant.controlplane.context.v1",
        context_hash: "hash-control",
        tenant_id: "tenant-1",
        governance_snapshot_id: "gov-snap",
        governance_hash: "gov-hash",
        plan_hash: "hash-plan",
        policy_hash: "policy-hash",
        registry_snapshot_hash: "reg-hash",
        trigger_type: "MANUAL",
        scheduled_at: { iso8601: "2026-07-31T12:00:00Z" },
        created_at: { iso8601: "2026-07-31T12:00:00Z" },
      };

      await controller.execute(plan, scheduled, control, mockWorker);

      expect(eventsReceived).toHaveLength(1);
      expect(eventsReceived[0].schema_version).toBe("execution.completed.v1");
      expect(eventsReceived[0].event_hash).toBeDefined();
      expect(eventsReceived[0].report.success).toBe(true);
    });
  });
});
