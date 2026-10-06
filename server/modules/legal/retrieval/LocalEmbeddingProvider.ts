/**
 * W-NO-GOOGLE-02A -- the local embedding provider of the legal retrieval path.
 *
 * Fully local: vectors come from one of the two frozen A7 candidates (BAAI/bge-m3,
 * intfloat/multilingual-e5-large) running offline from a pinned snapshot behind an injected
 * transport. Nothing here reaches a network, a cloud API or a credential.
 *
 * Fail closed, always:
 * - no model is guessed: the model must be named explicitly and be one of the two candidates;
 * - the runtime must prove it is exactly the pinned model (repo, full revision, pipeline,
 *   dimension, normalisation, and where the pipeline fixes it, max sequence length) on every call;
 * - a vector whose length is not exactly 1024 is an error -- never padded, never truncated;
 * - a runtime failure is an error -- never a substitute vector, never another provider;
 * - a device other than the required one is an error -- no hidden CPU fallback.
 */

import {
  getLocalEmbeddingPipelineByKey,
  LOCAL_EMBEDDING_DIMENSION,
  LOCAL_EMBEDDING_PIPELINES,
  type LocalEmbeddingPipelineSpec,
} from "@miljobeslut/mps-embedding-identity";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EmbeddingProviderError, type EmbeddingProvider } from "./EmbeddingProvider";
import { createLocalEmbeddingWorkerTransport } from "./LocalEmbeddingWorkerTransport";

export type LocalEmbeddingDevice = "cuda" | "cpu";

/** What the runtime says about itself with every result. Verified against the registry, then kept for audit. */
export interface LocalEmbeddingRuntimeReport {
  readonly hf_repo: string;
  readonly hf_revision: string;
  readonly pipeline_version: string;
  readonly dimension: number;
  readonly normalization: string;
  readonly device: string;
  readonly dtype: string;
  readonly max_seq_length: number;
  readonly truncated_count: number;
  readonly library_versions: Readonly<Record<string, string>>;
}

export interface LocalEmbeddingWireRequest {
  readonly role: "query" | "passage";
  /** Already carrying the pipeline's input prefix; the runtime adds nothing. */
  readonly texts: readonly string[];
  /** Fixed truncation length required by the pipeline, or null for the pinned model's own default. */
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

export interface LocalEmbeddingProvider extends EmbeddingProvider {
  /** Runtime report of the most recent successful call; null before the first one. */
  readonly last_runtime_report: LocalEmbeddingRuntimeReport | null;
  close(): Promise<void>;
}

/** Unit-vector sanity tolerance; vectors are produced L2-normalised by the pinned runtime. */
const NORM_TOLERANCE = 1e-3;

const DEVICE_VALUES: readonly LocalEmbeddingDevice[] = ["cuda", "cpu"];

function admittedKeys(): string {
  return LOCAL_EMBEDDING_PIPELINES.map((p) => p.key).join(", ");
}

function deviceMatches(actual: string, required: LocalEmbeddingDevice): boolean {
  return actual === required || actual.startsWith(`${required}:`);
}

function verifyRuntime(
  spec: LocalEmbeddingPipelineSpec,
  runtime: LocalEmbeddingRuntimeReport,
  requiredDevice: LocalEmbeddingDevice | undefined,
): void {
  const mismatches: string[] = [];
  if (runtime.hf_repo !== spec.hf_repo) mismatches.push(`repo '${runtime.hf_repo}' != '${spec.hf_repo}'`);
  if (runtime.hf_revision !== spec.hf_revision) mismatches.push(`revision '${runtime.hf_revision}' != '${spec.hf_revision}'`);
  if (runtime.pipeline_version !== spec.pipeline_version) {
    mismatches.push(`pipeline '${runtime.pipeline_version}' != '${spec.pipeline_version}'`);
  }
  if (runtime.dimension !== LOCAL_EMBEDDING_DIMENSION) mismatches.push(`dimension ${runtime.dimension} != ${LOCAL_EMBEDDING_DIMENSION}`);
  if (runtime.normalization !== spec.normalization) mismatches.push(`normalization '${runtime.normalization}' != '${spec.normalization}'`);
  if (spec.max_seq_length !== null && runtime.max_seq_length !== spec.max_seq_length) {
    mismatches.push(`max_seq_length ${runtime.max_seq_length} != ${spec.max_seq_length}`);
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
        `embedding ${i} has ${Array.isArray(vector) ? vector.length : "no"} dimensions, expected exactly ${LOCAL_EMBEDDING_DIMENSION} -- ` +
          "never padded or truncated",
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
  /** Registry key of one of the two frozen candidates. */
  readonly key: string;
  readonly transport: LocalEmbeddingTransport;
  /** When set, a result produced on another device is rejected. */
  readonly requiredDevice?: LocalEmbeddingDevice;
}

export function createLocalEmbeddingProvider(options: CreateLocalEmbeddingProviderOptions): LocalEmbeddingProvider {
  const spec = getLocalEmbeddingPipelineByKey(options.key);
  if (!spec) {
    throw new EmbeddingProviderError(
      "EMBEDDING_MODEL_NOT_ALLOWED",
      `'${options.key}' is not an admitted local embedding model (admitted: ${admittedKeys()})`,
    );
  }
  const { transport, requiredDevice } = options;
  let lastReport: LocalEmbeddingRuntimeReport | null = null;

  async function run(role: "query" | "passage", texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const prefix = role === "query" ? spec!.query_prefix : spec!.passage_prefix;
    const request: LocalEmbeddingWireRequest = {
      role,
      texts: texts.map((t) => `${prefix}${t}`),
      max_seq_length: spec!.max_seq_length,
    };
    let response: LocalEmbeddingWireResponse;
    try {
      response = await transport.embed(spec!, request);
    } catch (cause) {
      throw new EmbeddingProviderError(
        "EMBEDDING_LOCAL_RUNTIME_FAILED",
        `the local embedding runtime failed: ${cause instanceof Error ? cause.message : String(cause)} -- no vector was produced and nothing was substituted`,
        { cause },
      );
    }
    verifyRuntime(spec!, response.runtime, requiredDevice);
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
    async close() {
      await transport.close?.();
    },
  };
}

export interface LocalEmbeddingTransportConfig {
  readonly pythonPath: string;
  readonly hfHome: string;
  readonly device: LocalEmbeddingDevice;
  readonly workerScript: string;
  readonly timeoutMs: number;
}

export interface LocalEmbeddingEnvDeps {
  /** Test seam: replaces the real child-process transport. */
  readonly createTransport?: (config: LocalEmbeddingTransportConfig) => LocalEmbeddingTransport;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** The bundled worker sits next to this module; the working directory is only the fallback for loaders that give no file URL. */
function defaultWorkerScript(): string {
  const here = import.meta.url;
  if (typeof here === "string" && here.startsWith("file:")) {
    return path.join(path.dirname(fileURLToPath(here)), "localEmbeddingWorker.py");
  }
  return path.resolve(process.cwd(), "server/modules/legal/retrieval/localEmbeddingWorker.py");
}

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

/**
 * Builds the provider from explicit configuration. There is no default model and no default runtime:
 * an unconfigured process cannot embed, and says so.
 *
 *   MIMER_LOCAL_EMBEDDING_MODEL    bge-m3 | multilingual-e5-large   (required)
 *   MIMER_LOCAL_EMBEDDING_PYTHON   python interpreter of the pinned runtime   (required)
 *   MIMER_LOCAL_EMBEDDING_HF_HOME  Hugging Face home holding the pinned snapshots   (required)
 *   MIMER_LOCAL_EMBEDDING_DEVICE   cuda | cpu   (default cuda; a cpu run is only ever explicit)
 *   MIMER_LOCAL_EMBEDDING_TIMEOUT_MS   per-request timeout   (default 120000)
 *   MIMER_LOCAL_EMBEDDING_WORKER_SCRIPT   override of the bundled worker script   (optional)
 */
export function createLocalEmbeddingProviderFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  deps: LocalEmbeddingEnvDeps = {},
): LocalEmbeddingProvider {
  const key = required(env, "MIMER_LOCAL_EMBEDDING_MODEL");
  if (!getLocalEmbeddingPipelineByKey(key)) {
    throw new EmbeddingProviderError(
      "EMBEDDING_MODEL_NOT_ALLOWED",
      `MIMER_LOCAL_EMBEDDING_MODEL '${key}' is not an admitted local embedding model (admitted: ${admittedKeys()})`,
    );
  }
  const pythonPath = required(env, "MIMER_LOCAL_EMBEDDING_PYTHON");
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

  const workerScript = env.MIMER_LOCAL_EMBEDDING_WORKER_SCRIPT?.trim() || defaultWorkerScript();

  const config: LocalEmbeddingTransportConfig = { pythonPath, hfHome, device, workerScript, timeoutMs };
  const transport =
    deps.createTransport?.(config) ??
    createLocalEmbeddingWorkerTransport({
      command: pythonPath,
      buildArgs: (spec) => [
        workerScript,
        "--hf-home",
        hfHome,
        "--repo",
        spec.hf_repo,
        "--revision",
        spec.hf_revision,
        "--pipeline",
        spec.pipeline_version,
        "--dimension",
        String(LOCAL_EMBEDDING_DIMENSION),
        "--device",
        device,
      ],
      hfHome,
      device,
      timeoutMs,
      startupTimeoutMs: Math.max(timeoutMs, 300_000),
    });

  return createLocalEmbeddingProvider({ key, transport, requiredDevice: device });
}
