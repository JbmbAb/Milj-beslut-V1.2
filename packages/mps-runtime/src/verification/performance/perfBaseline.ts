/**
 * Fas 8A — Release Performance Gate baselines.
 * Ceilings catch regressions; structural counts prove the gate exercised intended scale.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type PerfMetricKey =
  | "manifests_10k"
  | "replay_10k"
  | "workers_100"
  | "cas_lookups_100k"
  | "registry_resolve_100k"
  | "queue_10k"
  | "workflow_1k";

export type ReleaseGateBaseline = {
  readonly version: number;
  readonly suite: string;
  readonly regression_factor: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly ceilings_ms: Readonly<Record<PerfMetricKey, number>>;
  measured_ms_reference: Record<PerfMetricKey, number | null> & {
    note?: string;
  };
};

const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "baselines",
  "release-gate.v1.json",
);

/** Minimum ceiling so CI runners with higher variance stay green. */
const CEILING_FLOOR_MS: Record<PerfMetricKey, number> = {
  manifests_10k: 60_000,
  replay_10k: 60_000,
  workers_100: 30_000,
  cas_lookups_100k: 60_000,
  registry_resolve_100k: 15_000,
  queue_10k: 60_000,
  workflow_1k: 60_000,
};

export function loadReleaseGateBaseline(): ReleaseGateBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as ReleaseGateBaseline;
}

export function elapsedMs(started: number): number {
  return Date.now() - started;
}

export function assertUnderCeiling(
  baseline: ReleaseGateBaseline,
  key: PerfMetricKey,
  measuredMs: number,
): void {
  const ceiling = baseline.ceilings_ms[key];
  if (measuredMs > ceiling) {
    throw new Error(
      `Perf regression [${key}]: ${measuredMs}ms > ceiling ${ceiling}ms (baseline ${BASELINE_PATH})`,
    );
  }
}

/**
 * When MPS_UPDATE_PERF_BASELINE=1, rewrite measured_ms_reference and
 * set ceilings to max(measured * regression_factor, per-metric floor).
 */
export function maybeUpdateBaseline(
  baseline: ReleaseGateBaseline,
  samples: Partial<Record<PerfMetricKey, number>>,
): void {
  if (process.env.MPS_UPDATE_PERF_BASELINE !== "1") return;

  const ceilings: Record<PerfMetricKey, number> = { ...baseline.ceilings_ms };
  const measured: ReleaseGateBaseline["measured_ms_reference"] = {
    ...baseline.measured_ms_reference,
    note: `Captured ${new Date().toISOString()}`,
  };

  for (const [key, ms] of Object.entries(samples) as [PerfMetricKey, number][]) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) continue;
    measured[key] = ms;
    const proposed = Math.ceil(ms * baseline.regression_factor);
    ceilings[key] = Math.max(proposed, CEILING_FLOOR_MS[key]);
  }

  const next = {
    version: baseline.version,
    suite: baseline.suite,
    description:
      "Fas 8A — CI release regression ceilings (ms). Update via MPS_UPDATE_PERF_BASELINE=1 after intentional perf work.",
    regression_factor: baseline.regression_factor,
    counts: baseline.counts,
    ceilings_ms: ceilings,
    measured_ms_reference: measured,
  };

  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
