/**
 * Epoch II Verification Fas 8A — Release Performance Gate (blocking for release CI)
 *
 * Regression ceilings + scale counts against golden baseline
 * `baselines/release-gate.v1.json`.
 *
 * Update ceilings after intentional perf work:
 *   MPS_UPDATE_PERF_BASELINE=1 npx vitest run .../ReleasePerformanceGate.test.ts
 */

import { describe, it, expect, afterAll } from "vitest";
import { DefaultReplayEngine } from "../../replay/DefaultReplayEngine.js";
import {
  CasBackedArtifactRepository,
  MemoryByteStorageBackend,
} from "../../repository/CasBackedArtifactRepository.js";
import { sha256ContentHash } from "../../kernel/ExecutionKernel.js";
import { createRegistryRuntime } from "../../registry/RegistryRuntime.js";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
  runWorkflowOnce,
} from "../harness/PlatformHarness.js";
import { createExecutionInfrastructure } from "../../../../mps-control-plane/src/execution-infrastructure/ExecutionInfrastructure.js";
import { InMemoryExecutionTicketQueue } from "../../../../mps-control-plane/src/ExecutionTicketQueue.js";
import {
  assertUnderCeiling,
  elapsedMs,
  loadReleaseGateBaseline,
  maybeUpdateBaseline,
  type PerfMetricKey,
} from "./perfBaseline.js";

const GATE_TIMEOUT_MS = 300_000;
const baseline = loadReleaseGateBaseline();
const samples: Partial<Record<PerfMetricKey, number>> = {};

function record(key: PerfMetricKey, ms: number): void {
  samples[key] = ms;
  assertUnderCeiling(baseline, key, ms);
}

describe("Fas 8A — Release Performance Gate", () => {
  it(
    "10k ExecutionManifests complete under ceiling",
    async () => {
      const n = baseline.counts.manifests;
      const seed = "seed:perf-manifest";
      const harness = createPlatformHarness({
        snapshot_id: "snap-perf-m",
        release_id: "rel-perf-m",
        seed,
        capabilities: [
          {
            artifact_id: "cap-perf",
            capability_key: "perf.cap",
            implementation_id: "impl-perf",
            handler: async (inputs) => [
              { artifact_id: `out-${inputs[0]?.artifact_id ?? "x"}` },
            ],
          },
        ],
      });

      const started = Date.now();
      let admitted = 0;
      for (let i = 0; i < n; i++) {
        const manifest = buildManifest({
          manifest_id: `m-perf-${i}`,
          capability_id: "cap-perf",
          seed: `${seed}:${i}`,
        });
        const { result } = await runCapabilityOnce(harness, manifest);
        if (result.admission.decision === "admitted") admitted += 1;
      }
      record("manifests_10k", elapsedMs(started));
      expect(admitted).toBe(n);
    },
    GATE_TIMEOUT_MS,
  );

  it(
    "10k Replay under ceiling (byte-stable content_hash)",
    async () => {
      const n = baseline.counts.replays;
      const seed = "seed:perf-replay";
      const harness = createPlatformHarness({
        snapshot_id: "snap-perf-r",
        release_id: "rel-perf-r",
        seed,
        capabilities: [
          {
            artifact_id: "cap-replay",
            capability_key: "perf.replay",
            implementation_id: "impl-replay",
            handler: async () => [{ artifact_id: "finding-perf" }],
          },
        ],
      });
      const manifest = buildManifest({
        manifest_id: "m-perf-replay-root",
        capability_id: "cap-replay",
        seed,
      });
      const { result } = await runCapabilityOnce(harness, manifest);
      expect(result.outcome).not.toBeNull();

      const replayEngine = new DefaultReplayEngine(harness.repo);
      const ref = {
        artifact_id: manifest.manifest_id,
        artifact_type: "execution_manifest" as const,
      };

      const started = Date.now();
      let lastHash: string | null = null;
      for (let i = 0; i < n; i++) {
        const r = await replayEngine.replay(ref, result.state);
        if (lastHash === null) lastHash = r.content_hash.value;
        else expect(r.content_hash.value).toBe(lastHash);
      }
      record("replay_10k", elapsedMs(started));
      expect(lastHash).toBeTruthy();
    },
    GATE_TIMEOUT_MS,
  );

  it(
    "100 concurrent workers drain queue under ceiling",
    async () => {
      const workers = baseline.counts.concurrent_workers;
      const tickets = workers * 10;
      const queue = new InMemoryExecutionTicketQueue();
      const ei = createExecutionInfrastructure(queue);

      for (let i = 0; i < tickets; i++) {
        await ei.enqueueIdempotent(`idem-${i}`, `t-${i}`, {
          artifact_id: `m-${i}`,
          artifact_type: "execution_manifest",
        });
      }

      // Serialize reserve only — in-memory queue is not concurrent-safe on reserve;
      // workers still run concurrently for complete / scheduling.
      let reserveChain: Promise<unknown> = Promise.resolve();
      const reserveLocked = (workerId: string) => {
        const run = reserveChain.then(() => ei.reserve(workerId));
        reserveChain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      };

      const started = Date.now();
      await Promise.all(
        Array.from({ length: workers }, async (_, w) => {
          const workerId = `worker-${w}`;
          for (;;) {
            const ticket = await reserveLocked(workerId);
            if (!ticket) return;
            await ei.complete(ticket.ticket_id);
          }
        }),
      );
      record("workers_100", elapsedMs(started));

      const pending = (await queue.list?.("pending")) ?? [];
      const leased = (await queue.list?.("leased")) ?? [];
      const completed = (await queue.list?.("completed")) ?? [];
      expect(pending.length + leased.length).toBe(0);
      expect(completed.length).toBe(tickets);
    },
    GATE_TIMEOUT_MS,
  );

  it(
    "100k CAS lookups under ceiling",
    async () => {
      const n = baseline.counts.cas_lookups;
      const storeCount = 1_000;
      const backend = new MemoryByteStorageBackend();
      const repo = new CasBackedArtifactRepository(backend);

      for (let i = 0; i < storeCount; i++) {
        const body = { i };
        await repo.put({
          artifact_id: `cas-${i}`,
          content_hash: sha256ContentHash(body),
          body,
        });
      }

      const started = Date.now();
      for (let i = 0; i < n; i++) {
        const id = `cas-${i % storeCount}`;
        const body = await repo.resolve<{ i: number }>({
          artifact_id: id,
          artifact_type: "generic",
        });
        expect(body.i).toBe(i % storeCount);
      }
      record("cas_lookups_100k", elapsedMs(started));
    },
    GATE_TIMEOUT_MS,
  );

  it(
    "Registry resolve benchmark under ceiling",
    async () => {
      const n = baseline.counts.registry_resolves;
      const caps = Array.from({ length: 500 }, (_, i) => ({
        artifact_id: `cap-${i}`,
        artifact_type: "CAPABILITY_DEFINITION" as const,
        capability_key: `perf.key.${i}`,
        capability_version: "1.0.0",
        implementation_ref: { artifact_id: `impl-${i}` },
        input_types: ["IN"],
        output_types: ["OUT"],
      }));
      const registry = createRegistryRuntime({
        snapshot_id: "snap-perf-reg",
        release_id: "rel-perf-reg",
        capabilities: caps,
        workflows: [],
      });

      const started = Date.now();
      let hits = 0;
      for (let i = 0; i < n; i++) {
        const key = `perf.key.${i % caps.length}`;
        const hit = registry.resolveCapabilityByKey(key);
        if (hit) hits += 1;
      }
      record("registry_resolve_100k", elapsedMs(started));
      expect(hits).toBe(n);
    },
    GATE_TIMEOUT_MS,
  );

  it(
    "Queue benchmark under ceiling",
    async () => {
      const n = baseline.counts.queue_ops;
      const queue = new InMemoryExecutionTicketQueue();
      const ei = createExecutionInfrastructure(queue);

      const started = Date.now();
      for (let i = 0; i < n; i++) {
        await ei.enqueueIdempotent(`q-${i}`, `qt-${i}`, {
          artifact_id: `qm-${i}`,
          artifact_type: "execution_manifest",
        });
      }
      for (let i = 0; i < n; i++) {
        const again = await ei.enqueueIdempotent(`q-${i}`, `qt-other-${i}`, {
          artifact_id: `qm-${i}`,
          artifact_type: "execution_manifest",
        });
        expect(again.ticket_id).toBe(`qt-${i}`);
      }
      for (let i = 0; i < n; i++) {
        const t = await ei.reserve("bench-worker");
        expect(t).not.toBeNull();
        await ei.complete(t!.ticket_id);
      }
      record("queue_10k", elapsedMs(started));
    },
    GATE_TIMEOUT_MS,
  );

  it(
    "Workflow benchmark under ceiling",
    async () => {
      const n = baseline.counts.workflow_runs;
      const seed = "seed:perf-wf";
      const harness = createPlatformHarness({
        snapshot_id: "snap-perf-wf",
        release_id: "rel-perf-wf",
        seed,
        capabilities: [
          {
            artifact_id: "cap-a",
            capability_key: "perf.a",
            implementation_id: "impl-a",
            handler: async (inputs) => [
              { artifact_id: `mid-${inputs[0]?.artifact_id ?? "x"}` },
            ],
          },
          {
            artifact_id: "cap-b",
            capability_key: "perf.b",
            implementation_id: "impl-b",
            handler: async (inputs) => [
              { artifact_id: `out-${inputs[0]?.artifact_id ?? "x"}` },
            ],
          },
        ],
        workflows: [
          {
            artifact_id: "wf-perf",
            workflow_key: "perf.pipeline",
            steps: [
              { step_id: "A", capability_id: "cap-a" },
              { step_id: "B", capability_id: "cap-b" },
            ],
          },
        ],
      });

      const started = Date.now();
      let ok = 0;
      for (let i = 0; i < n; i++) {
        const { execution } = await runWorkflowOnce(harness, "wf-perf", [
          { artifact_id: `in-${i}`, artifact_type: "IN" },
        ]);
        if (execution.execution_refs.length === 2) ok += 1;
      }
      record("workflow_1k", elapsedMs(started));
      expect(ok).toBe(n);
    },
    GATE_TIMEOUT_MS,
  );

  afterAll(() => {
    maybeUpdateBaseline(baseline, samples);
  });
});
