import { describe, it, expect, afterEach } from "vitest";
import {
  buildManifest,
  createPlatformHarness,
  runCapabilityOnce,
} from "../harness/PlatformHarness.js";

const ENV_KEYS = [
  "TZ",
  "LANG",
  "LC_ALL",
  "HOSTNAME",
  "COMPUTERNAME",
  "WORKER_ID",
  "TRACE_ID",
  "OTEL_SERVICE_NAME",
] as const;

describe("Architecture Invariant — IdentityIsolation", () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
    {};

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("env/time/host/trace/worker noise does not change execution identity", async () => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }

    const seed = "seed:identity-iso";
    const run = async () => {
      const harness = createPlatformHarness({
        snapshot_id: "snap-iso",
        release_id: "rel-iso",
        seed,
        capabilities: [
          {
            artifact_id: "cap-iso",
            capability_key: "verify.iso",
            implementation_id: "impl-iso",
            handler: async () => [{ artifact_id: "iso-out" }],
          },
        ],
      });
      const manifest = buildManifest({
        manifest_id: "m-iso",
        capability_id: "cap-iso",
        seed,
      });
      return runCapabilityOnce(harness, manifest);
    };

    process.env.TZ = "UTC";
    process.env.LANG = "C";
    process.env.HOSTNAME = "host-a";
    process.env.WORKER_ID = "w-1";
    process.env.TRACE_ID = "trace-aaa";
    const a = await run();

    process.env.TZ = "America/Los_Angeles";
    process.env.LANG = "sv_SE.UTF-8";
    process.env.HOSTNAME = "host-b-different";
    process.env.WORKER_ID = "w-999";
    process.env.TRACE_ID = "trace-zzz";
    process.env.OTEL_SERVICE_NAME = "noise-service";
    const b = await run();

    expect(a.result.attempt?.content_hash.value).toBe(
      b.result.attempt?.content_hash.value,
    );
    expect(a.result.outcome?.content_hash.value).toBe(
      b.result.outcome?.content_hash.value,
    );
    expect(a.result.capability_executions[0]?.content_hash.value).toBe(
      b.result.capability_executions[0]?.content_hash.value,
    );
    expect(a.obs.trace.trace_id).toBe(b.obs.trace.trace_id);
    // Wall-clock / PID must not appear in identities
    expect(a.result.attempt?.attempt_id).not.toMatch(/pid|Date\.now/i);
  });
});
