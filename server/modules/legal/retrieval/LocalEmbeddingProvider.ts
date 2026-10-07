/**
 * W-NO-GOOGLE-02A -- governed local embedding provider for legal retrieval.
 *
 * Frozen candidates are available to the evaluation seam. Production creation additionally requires
 * an explicit governed admission (LocalEmbeddingAdmission.ts), which names exactly one pipeline: the
 * owner selected BAAI/bge-m3 on 2026-10-07 after the frozen model-selection evaluation.
 */
import fs from "node:fs";
import path from "node:path";
import {
  bindLocalEmbeddingIdentity,
  getLocalEmbeddingPipelineByKey,
  LOCAL_EMBEDDING_DIMENSION,
  LOCAL_EMBEDDING_PIPELINES,
  type LocalEmbeddingKey,
  type LocalEmbeddingPipelineSpec,
} from "@miljobeslut/mps-embedding-identity";
import { EmbeddingProviderError, type EmbeddingProvider } from "./EmbeddingProvider";
import { isProductionAdmittedLocalEmbeddingKey, productionAdmittedLocalEmbeddingKeys } from "./LocalEmbeddingAdmission";
import {
  issueLocalEmbeddingForProvider,
  type IssuedLocalEmbedding,
} from "./LocalEmbeddingProvenance";
import { createLocalEmbeddingWorkerTransport } from "./LocalEmbeddingWorkerTransport";

export type LocalEmbeddingDevice = "cuda" | "cpu";

export interface LocalEmbeddingRuntimeReport {
  readonly model_key: string;
  readonly hf_repo: string;
  readonly hf_revision: string;
  readonly pipeline_version: string;
  readonly dimension: number;
  readonly normalization: string;
  readonly device: string;
  readonly dtype: string;
  readonly max_seq_length: number;
  readonly truncated_count: number;
  readonly snapshot_revision: string;
  readonly snapshot_manifest_sha256: string;
  readonly interpreter_realpath: string;
  readonly library_versions: Readonly<Record<string, string>>;
}

export interface LocalEmbeddingWireRequest {
  readonly role: "query" | "passage";
  readonly texts: readonly string[];
  readonly max_seq_length: number | null;
}

export interface LocalEmbeddingWireResponse {
  readonly runtime: LocalEmbeddingRuntimeReport;
  readonly vectors: readonly (readonly number[])[];
}

export interface LocalEmbeddingTransport {
  embed(spec: LocalEmbeddingPipelineSpec, request: LocalEmbeddingWireRequest): Promise<LocalEmbeddingWireResponse>;
  close?(): Promise<void>;
}

export interface GovernedEmbeddingChunk {
  readonly fragment_id: string;
  readonly materialization_id: string;
  readonly chunk_content_hash: string;
  readonly text: string;
}

export interface LocalEmbeddingProvider extends EmbeddingProvider {
  readonly last_runtime_report: LocalEmbeddingRuntimeReport | null;
  embedPassagesIssued(chunks: readonly GovernedEmbeddingChunk[]): Promise<readonly IssuedLocalEmbedding[]>;
  close(): Promise<void>;
}

const NORM_TOLERANCE = 1e-3;
const DEVICE_VALUES: readonly LocalEmbeddingDevice[] = ["cuda", "cpu"];

function frozenCandidateKeys(): string {
  return LOCAL_EMBEDDING_PIPELINES.map((p) => p.key).join(", ");
}

function deviceMatches(actual: string, required: LocalEmbeddingDevice): boolean {
  return actual === required || actual.startsWith(`${required}:`);
}

function normalizePathForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function verifyRuntime(
  spec: LocalEmbeddingPipelineSpec,
  runtime: LocalEmbeddingRuntimeReport,
  requiredDevice: LocalEmbeddingDevice | undefined,
  expectedInterpreterRealpath: string | undefined,
): void {
  const mismatches: string[] = [];
  if (runtime.model_key !== spec.key) mismatches.push(`key '${runtime.model_key}' != '${spec.key}'`);
  if (runtime.hf_repo !== spec.hf_repo) mismatches.push(`repo '${runtime.hf_repo}' != '${spec.hf_repo}'`);
  if (runtime.hf_revision !== spec.hf_revision) mismatches.push(`revision '${runtime.hf_revision}' != '${spec.hf_revision}'`);
  if (runtime.pipeline_version !== spec.pipeline_version) {
    mismatches.push(`pipeline '${runtime.pipeline_version}' != '${spec.pipeline_version}'`);
  }
  if (runtime.dimension !== LOCAL_EMBEDDING_DIMENSION) {
    mismatches.push(`dimension ${runtime.dimension} != ${LOCAL_EMBEDDING_DIMENSION}`);
  }
  if (runtime.normalization !== spec.normalization) {
    mismatches.push(`normalization '${runtime.normalization}' != '${spec.normalization}'`);
  }
  if (runtime.dtype !== spec.dtype) {
    mismatches.push(`dtype '${runtime.dtype}' != '${spec.dtype}' (the evaluated precision is part of the pipeline identity)`);
  }
  if (runtime.snapshot_revision !== spec.hf_revision) {
    mismatches.push(`snapshot revision '${runtime.snapshot_revision}' != '${spec.hf_revision}'`);
  }
  if (runtime.snapshot_manifest_sha256 !== spec.snapshot_manifest_sha256) {
    mismatches.push("runtime-essential snapshot manifest digest differs from the frozen registry");
  }
  if (runtime.max_seq_length !== spec.max_seq_length) {
    mismatches.push(`max_seq_length ${runtime.max_seq_length} != ${spec.max_seq_length}`);
  }
  if (
    expectedInterpreterRealpath &&
    normalizePathForCompare(runtime.interpreter_realpath) !== normalizePathForCompare(expectedInterpreterRealpath)
  ) {
    mismatches.push("worker interpreter identity differs from the configured absolute interpreter");
  }
  if (mismatches.length > 0) {
    throw new EmbeddingProviderError(
      "EMBEDDING_RUNTIME_IDENTITY_MISMATCH",
      `the local runtime is not the pinned pipeline '${spec.pipeline_version}': ${mismatches.join("; ")}`,
    );
  }
  if (requiredDevice && !deviceMatches(runtime.device, requiredDevice)) {
    throw new EmbeddingProviderError(
      "EMBEDDING_RUNTIME_DEVICE_MISMATCH",
      `the runtime ran on '${runtime.device}' but '${requiredDevice}' is required -- no hidden fallback to another device`,
    );
  }
}

function verifyVectors(expectedCount: number, vectors: readonly (readonly number[])[]): void {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new EmbeddingProviderError(
      "EMBEDDING_BATCH_SIZE_MISMATCH",
      `requested ${expectedCount} embeddings, the runtime returned ${Array.isArray(vectors) ? vectors.length : "none"} -- failing closed`,
    );
  }
  vectors.forEach((vector, i) => {
    if (!Array.isArray(vector) || vector.length !== LOCAL_EMBEDDING_DIMENSION) {
      throw new EmbeddingProviderError(
        "EMBEDDING_DIMENSION_MISMATCH",
        `embedding ${i} has ${Array.isArray(vector) ? vector.length : "no"} dimensions, expected exactly ${LOCAL_EMBEDDING_DIMENSION} -- vectors are never padded or truncated`,
      );
    }
    let sumSquares = 0;
    for (let j = 0; j < vector.length; j++) {
      const x = vector[j];
      if (typeof x !== "number" || !Number.isFinite(x)) {
        throw new EmbeddingProviderError("EMBEDDING_NOT_FINITE", `embedding ${i}[${j}] is not a finite number`);
      }
      sumSquares += x * x;
    }
    if (Math.abs(Math.sqrt(sumSquares) - 1) > NORM_TOLERANCE) {
      throw new EmbeddingProviderError(
        "EMBEDDING_NOT_NORMALIZED",
        `embedding ${i} is not L2-normalised (norm ${Math.sqrt(sumSquares)})`,
      );
    }
  });
}

export interface CreateLocalEmbeddingProviderOptions {
  readonly key: string;
  readonly transport: LocalEmbeddingTransport;
  readonly requiredDevice?: LocalEmbeddingDevice;
  readonly expectedInterpreterRealpath?: string;
}

export function createLocalEmbeddingProvider(options: CreateLocalEmbeddingProviderOptions): LocalEmbeddingProvider {
  const spec = getLocalEmbeddingPipelineByKey(options.key);
  if (!spec) {
    throw new EmbeddingProviderError(
      "EMBEDDING_MODEL_NOT_ALLOWED",
      `'${options.key}' is not a frozen local embedding candidate (candidates: ${frozenCandidateKeys()})`,
    );
  }
  const { transport, requiredDevice, expectedInterpreterRealpath } = options;
  let lastReport: LocalEmbeddingRuntimeReport | null = null;

  async function run(role: "query" | "passage", texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const prefix = role === "query" ? spec.query_prefix : spec.passage_prefix;
    const request: LocalEmbeddingWireRequest = {
      role,
      texts: texts.map((t) => `${prefix}${t}`),
      max_seq_length: spec.max_seq_length,
    };
    let response: LocalEmbeddingWireResponse;
    try {
      response = await transport.embed(spec, request);
    } catch (cause) {
      throw new EmbeddingProviderError(
        "EMBEDDING_LOCAL_RUNTIME_FAILED",
        `the local embedding runtime failed: ${cause instanceof Error ? cause.message : String(cause)} -- no vector was produced and nothing was substituted`,
        { cause },
      );
    }
    verifyRuntime(spec, response.runtime, requiredDevice, expectedInterpreterRealpath);
    verifyVectors(texts.length, response.vectors);
    lastReport = response.runtime;
    return response.vectors;
  }

  return {
    model_id: spec.hf_repo,
    model_version: spec.hf_revision,
    pipeline_version: spec.pipeline_version,
    dimension: LOCAL_EMBEDDING_DIMENSION,
    get last_runtime_report() {
      return lastReport;
    },
    embedQueries: (texts) => run("query", texts),
    embedPassages: (texts) => run("passage", texts),
    async embedPassagesIssued(chunks) {
      const vectors = await run("passage", chunks.map((chunk) => chunk.text));
      const runtime = lastReport;
      if (!runtime) {
        throw new EmbeddingProviderError("EMBEDDING_LOCAL_RUNTIME_FAILED", "runtime provenance missing after successful embedding");
      }
      return chunks.map((chunk, i) =>
        issueLocalEmbeddingForProvider({
          identity: bindLocalEmbeddingIdentity(chunk, spec.key as LocalEmbeddingKey),
          vector: vectors[i]!,
          model_key: spec.key as LocalEmbeddingKey,
          snapshot_manifest_sha256: runtime.snapshot_manifest_sha256,
        }),
      );
    },
    async close() {
      await transport.close?.();
    },
  };
}

export interface LocalEmbeddingTransportConfig {
  readonly pythonPath: string;
  readonly hfHome: string;
  readonly device: LocalEmbeddingDevice;
  readonly timeoutMs: number;
}

export interface LocalEmbeddingEnvDeps {
  readonly createTransport?: (config: LocalEmbeddingTransportConfig) => LocalEmbeddingTransport;
  /** Test seam. Production uses the filesystem-backed validation below. */
  readonly resolveInterpreter?: (configuredPath: string) => string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      `${name} is not set -- the local embedding runtime is not configured and nothing will be substituted`,
    );
  }
  return value;
}

function validateAndResolveInterpreter(configuredPath: string): string {
  const isAbsolute = path.win32.isAbsolute(configuredPath) || path.posix.isAbsolute(configuredPath);
  if (!isAbsolute) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      "MIMER_LOCAL_EMBEDDING_PYTHON must be an absolute path to the pinned runtime interpreter",
    );
  }
  const basename = (configuredPath.includes("\\") ? path.win32 : path.posix).basename(configuredPath);
  const expected = process.platform === "win32" ? "python.exe" : "python";
  if (basename.toLowerCase() !== expected) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      `MIMER_LOCAL_EMBEDDING_PYTHON must name exactly '${expected}', got '${basename}'`,
    );
  }
  let stat: fs.Stats;
  let resolved: string;
  try {
    stat = fs.statSync(configuredPath);
    resolved = fs.realpathSync.native(configuredPath);
  } catch (cause) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      "MIMER_LOCAL_EMBEDDING_PYTHON does not resolve to the configured local interpreter",
      { cause },
    );
  }
  if (!stat.isFile()) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      "MIMER_LOCAL_EMBEDDING_PYTHON must resolve to a regular file",
    );
  }
  return resolved;
}

interface ParsedLocalEmbeddingEnv {
  readonly key: string;
  readonly pythonPath: string;
  readonly hfHome: string;
  readonly device: LocalEmbeddingDevice;
  readonly timeoutMs: number;
}

function parseLocalEmbeddingEnv(
  env: Readonly<Record<string, string | undefined>>,
  deps: LocalEmbeddingEnvDeps,
): ParsedLocalEmbeddingEnv {
  const key = required(env, "MIMER_LOCAL_EMBEDDING_MODEL");
  if (!getLocalEmbeddingPipelineByKey(key)) {
    throw new EmbeddingProviderError(
      "EMBEDDING_MODEL_NOT_ALLOWED",
      `MIMER_LOCAL_EMBEDDING_MODEL '${key}' is not a frozen local candidate (candidates: ${frozenCandidateKeys()})`,
    );
  }
  const configuredPython = required(env, "MIMER_LOCAL_EMBEDDING_PYTHON");
  const pythonPath = (deps.resolveInterpreter ?? validateAndResolveInterpreter)(configuredPython);
  const hfHome = required(env, "MIMER_LOCAL_EMBEDDING_HF_HOME");

  const deviceRaw = env.MIMER_LOCAL_EMBEDDING_DEVICE?.trim() || "cuda";
  if (!(DEVICE_VALUES as readonly string[]).includes(deviceRaw)) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      `MIMER_LOCAL_EMBEDDING_DEVICE '${deviceRaw}' is not one of ${DEVICE_VALUES.join(", ")}`,
    );
  }
  const device = deviceRaw as LocalEmbeddingDevice;
  const timeoutRaw = env.MIMER_LOCAL_EMBEDDING_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      `MIMER_LOCAL_EMBEDDING_TIMEOUT_MS '${timeoutRaw}' is not a positive integer`,
    );
  }
  return { key, pythonPath, hfHome, device, timeoutMs };
}

function buildProvider(parsed: ParsedLocalEmbeddingEnv, deps: LocalEmbeddingEnvDeps): LocalEmbeddingProvider {
  const config: LocalEmbeddingTransportConfig = {
    pythonPath: parsed.pythonPath,
    hfHome: parsed.hfHome,
    device: parsed.device,
    timeoutMs: parsed.timeoutMs,
  };
  const transport =
    deps.createTransport?.(config) ??
    createLocalEmbeddingWorkerTransport({
      pythonPath: parsed.pythonPath,
      hfHome: parsed.hfHome,
      device: parsed.device,
      timeoutMs: parsed.timeoutMs,
      startupTimeoutMs: Math.max(parsed.timeoutMs, 300_000),
    });
  return createLocalEmbeddingProvider({
    key: parsed.key,
    transport,
    requiredDevice: parsed.device,
    expectedInterpreterRealpath: parsed.pythonPath,
  });
}

/** Evaluation-only seam: frozen candidates may run, but this creates no production admission. */
export function createLocalEmbeddingProviderForEvaluationFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  deps: LocalEmbeddingEnvDeps = {},
): LocalEmbeddingProvider {
  return buildProvider(parseLocalEmbeddingEnv(env, deps), deps);
}

/**
 * Production seam: only the production-admitted pipeline (exactly one, see LocalEmbeddingAdmission.ts) can be
 * created, and only when MIMER_LOCAL_EMBEDDING_MODEL names it explicitly. There is no default and no fallback.
 */
export function createLocalEmbeddingProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  deps: LocalEmbeddingEnvDeps = {},
): LocalEmbeddingProvider {
  const key = required(env, "MIMER_LOCAL_EMBEDDING_MODEL");
  if (!isProductionAdmittedLocalEmbeddingKey(key)) {
    const admitted = productionAdmittedLocalEmbeddingKeys();
    throw new EmbeddingProviderError(
      "EMBEDDING_MODEL_NOT_ALLOWED",
      `local embedding model '${key}' is not production-admitted (production admits exactly: ${admitted.length > 0 ? admitted.join(", ") : "none"})`,
    );
  }
  return buildProvider(parseLocalEmbeddingEnv(env, deps), deps);
}

let sharedProduction: { readonly configKey: string; readonly provider: LocalEmbeddingProvider } | null = null;

function productionConfigKey(env: Readonly<Record<string, string | undefined>>): string {
  return [
    env.MIMER_LOCAL_EMBEDDING_MODEL ?? "",
    env.MIMER_LOCAL_EMBEDDING_PYTHON ?? "",
    env.MIMER_LOCAL_EMBEDDING_HF_HOME ?? "",
    env.MIMER_LOCAL_EMBEDDING_DEVICE ?? "cuda",
    env.MIMER_LOCAL_EMBEDDING_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
  ].join("\0");
}

/** Request-safe production provider: repeated compositions share one worker/model instance. */
export function getSharedLocalEmbeddingProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  deps: LocalEmbeddingEnvDeps = {},
): LocalEmbeddingProvider {
  const key = productionConfigKey(env);
  if (sharedProduction) {
    if (sharedProduction.configKey !== key) {
      throw new EmbeddingProviderError(
        "EMBEDDING_PROVIDER_NOT_CONFIGURED",
        "local embedding configuration changed while the shared production provider is live; shutdown is required before reconfiguration",
      );
    }
    return sharedProduction.provider;
  }
  const provider = createLocalEmbeddingProviderFromEnv(env, deps);
  sharedProduction = { configKey: key, provider };
  return provider;
}

export async function shutdownSharedLocalEmbeddingProvider(): Promise<void> {
  const current = sharedProduction;
  sharedProduction = null;
  if (current) await current.provider.close();
}
