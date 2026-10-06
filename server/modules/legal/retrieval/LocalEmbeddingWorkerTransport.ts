/**
 * W-NO-GOOGLE-02A -- stdio transport to the local embedding worker.
 *
 * One bounded, long-lived child process per transport. The executable is an exact absolute Python
 * path selected by governed configuration: no shell, no PATH lookup and no alternate interpreter.
 * The child receives an allowlisted environment and is forced offline.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type { LocalEmbeddingPipelineSpec } from "@miljobeslut/mps-embedding-identity";
import type {
  LocalEmbeddingRuntimeReport,
  LocalEmbeddingTransport,
  LocalEmbeddingWireRequest,
  LocalEmbeddingWireResponse,
} from "./LocalEmbeddingProvider";

export interface LocalEmbeddingWorkerTransportOptions {
  /** Exact absolute interpreter path. Never resolved through PATH. */
  readonly pythonPath: string;
  readonly hfHome: string;
  readonly device: "cuda" | "cpu";
  readonly timeoutMs: number;
  readonly startupTimeoutMs: number;
  /** Number of replacement workers permitted after the first worker fails. */
  readonly restartBudget?: number;
  /** Test seam; production uses spawnPinnedWorker. */
  readonly spawnWorker?: (
    pythonPath: string,
    environment: Readonly<Record<string, string>>,
    spec: LocalEmbeddingPipelineSpec,
  ) => ChildProcessWithoutNullStreams;
}

const INHERITED_ENV_KEYS: ReadonlySet<string> = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "LANG",
  "LC_ALL",
  "CUDA_PATH",
  "CUDA_VISIBLE_DEVICES",
]);

export interface WorkerEnvironmentInput {
  readonly hfHome: string;
  readonly device: "cuda" | "cpu";
  readonly modelKey: string;
}

/** The model identity crosses the process boundary only as a closed key. */
export function buildWorkerEnvironment(
  input: WorkerEnvironmentInput,
  parent: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined || !INHERITED_ENV_KEYS.has(name.toUpperCase())) continue;
    env[name] = value;
  }
  return {
    ...env,
    HF_HOME: input.hfHome,
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    TOKENIZERS_PARALLELISM: "false",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    MIMER_EMBED_MODEL_KEY: input.modelKey,
    MIMER_EMBED_DEVICE: input.device,
  };
}

function repositoryRoot(): string {
  const here = import.meta.url;
  if (typeof here === "string" && here.startsWith("file:")) {
    return path.resolve(path.dirname(fileURLToPath(here)), "../../../..");
  }
  return process.cwd();
}

const WORKER_SCRIPT = "server/modules/legal/retrieval/localEmbeddingWorker.py";

function spawnPinnedWorker(
  pythonPath: string,
  environment: Readonly<Record<string, string>>,
): ChildProcessWithoutNullStreams {
  return spawn(pythonPath, [WORKER_SCRIPT], {
    env: { ...environment },
    cwd: repositoryRoot(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });
}

interface Pending {
  readonly id: number;
  readonly resolve: (response: LocalEmbeddingWireResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

interface WorkerHandle {
  readonly specKey: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: Promise<void>;
  readonly pending: Map<number, Pending>;
  stderrTail: string;
  failed: boolean;
  nextId: number;
}

const STDERR_TAIL_BYTES = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalPathForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function createLocalEmbeddingWorkerTransport(
  options: LocalEmbeddingWorkerTransportOptions,
): LocalEmbeddingTransport {
  const restartBudget = options.restartBudget ?? 2;
  if (!Number.isInteger(restartBudget) || restartBudget < 0) {
    throw new Error("local embedding restartBudget must be a non-negative integer");
  }

  const configuredInterpreter = fs.realpathSync.native(options.pythonPath);
  let worker: WorkerHandle | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let failures = 0;
  let closed = false;
  let latchedError: Error | null = null;

  function fail(handle: WorkerHandle, error: Error, countFailure = true): void {
    if (handle.failed) return;
    handle.failed = true;
    if (worker === handle) worker = null;
    if (countFailure) {
      failures += 1;
      if (failures > restartBudget) {
        latchedError = new Error(
          `local embedding worker restart budget exhausted after ${failures} failures; no further worker will be started`,
        );
      }
    }
    for (const pending of handle.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    handle.pending.clear();
    if (handle.child.exitCode === null && handle.child.signalCode === null) handle.child.kill();
  }

  function start(spec: LocalEmbeddingPipelineSpec): WorkerHandle {
    if (closed) throw new Error("local embedding transport is closed");
    if (latchedError) throw latchedError;

    const environment = buildWorkerEnvironment({
      hfHome: options.hfHome,
      device: options.device,
      modelKey: spec.key,
    });
    const child = options.spawnWorker
      ? options.spawnWorker(configuredInterpreter, environment, spec)
      : spawnPinnedWorker(configuredInterpreter, environment);

    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    ready.catch(() => undefined);

    const handle: WorkerHandle = {
      specKey: spec.key,
      child,
      ready,
      pending: new Map(),
      stderrTail: "",
      failed: false,
      nextId: 1,
    };
    let isReady = false;

    const startupTimer = setTimeout(() => {
      if (!isReady) {
        const error = new Error(`local embedding worker startup timed out after ${options.startupTimeoutMs} ms (not ready)`);
        rejectReady(error);
        fail(handle, error);
      }
    }, options.startupTimeoutMs);
    startupTimer.unref?.();

    child.stderr.on("data", (chunk: Buffer) => {
      handle.stderrTail = (handle.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (handle.failed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (parseError) {
        const error = new Error(
          `local embedding worker produced malformed output (not JSON): ${parseError instanceof Error ? parseError.message : "parse error"}`,
        );
        rejectReady(error);
        fail(handle, error);
        return;
      }
      if (!isRecord(parsed)) {
        const error = new Error("local embedding worker produced a protocol value that is not an object");
        rejectReady(error);
        fail(handle, error);
        return;
      }
      const message = parsed;
      if (message.type === "ready") {
        if (!isRecord(message.runtime) || typeof message.runtime.interpreter_realpath !== "string") {
          const error = new Error("local embedding worker ready message lacks a runtime/interpreter identity");
          rejectReady(error);
          fail(handle, error);
          return;
        }
        if (canonicalPathForCompare(message.runtime.interpreter_realpath) !== canonicalPathForCompare(configuredInterpreter)) {
          const error = new Error("local embedding worker interpreter identity differs from the configured absolute interpreter");
          rejectReady(error);
          fail(handle, error);
          return;
        }
        isReady = true;
        clearTimeout(startupTimer);
        resolveReady();
        return;
      }

      const id = message.id;
      const pending = typeof id === "number" ? handle.pending.get(id) : undefined;
      if (!pending) {
        fail(handle, new Error("local embedding worker sent a response that does not belong to any request"));
        return;
      }
      handle.pending.delete(pending.id);
      clearTimeout(pending.timer);

      if (message.type === "error") {
        pending.reject(new Error(String(message.message ?? "local embedding worker reported an error")));
        return;
      }
      if (message.type === "result") {
        if (!isRecord(message.runtime) || !Array.isArray(message.vectors)) {
          const error = new Error("local embedding worker result lacks a runtime object or vector array");
          pending.reject(error);
          fail(handle, error);
          return;
        }
        pending.resolve({
          runtime: message.runtime as unknown as LocalEmbeddingRuntimeReport,
          vectors: message.vectors as readonly (readonly number[])[],
        });
        return;
      }

      const error = new Error(`local embedding worker sent an unknown message type '${String(message.type)}'`);
      pending.reject(error);
      fail(handle, error);
    });

    child.on("error", (cause) => {
      const error = new Error(`local embedding worker could not be started: ${cause.message}`);
      rejectReady(error);
      fail(handle, error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(startupTimer);
      const tail = handle.stderrTail.trim();
      const detail = tail ? ` (${tail.split(/\r?\n/).slice(-3).join(" | ")})` : "";
      const error = new Error(
        isReady
          ? `local embedding worker exited (code ${code ?? "none"}, signal ${signal ?? "none"})${detail}`
          : `local embedding worker exited before ready (code ${code ?? "none"}, signal ${signal ?? "none"})${detail}`,
      );
      rejectReady(error);
      fail(handle, error);
    });
    child.stdin.on("error", () => undefined);

    return handle;
  }

  async function embedOnce(
    spec: LocalEmbeddingPipelineSpec,
    request: LocalEmbeddingWireRequest,
  ): Promise<LocalEmbeddingWireResponse> {
    if (closed) throw new Error("local embedding transport is closed");
    if (latchedError) throw latchedError;
    if (worker && worker.specKey !== spec.key) {
      throw new Error(`this transport is bound to '${worker.specKey}' and refuses to serve '${spec.key}'`);
    }
    const handle = worker ?? (worker = start(spec));
    await handle.ready;
    if (handle.failed) throw new Error("local embedding worker is no longer running");

    return new Promise<LocalEmbeddingWireResponse>((resolve, reject) => {
      const id = handle.nextId++;
      const timer = setTimeout(() => {
        fail(handle, new Error(`local embedding request timed out after ${options.timeoutMs} ms`));
      }, options.timeoutMs);
      timer.unref?.();
      handle.pending.set(id, { id, resolve, reject, timer });
      handle.child.stdin.write(
        `${JSON.stringify({ id, op: "embed", role: request.role, texts: request.texts, max_seq_length: request.max_seq_length })}\n`,
        (error) => {
          if (error) fail(handle, new Error(`could not write to the local embedding worker: ${error.message}`));
        },
      );
    });
  }

  return {
    embed(spec, request) {
      const run = chain.then(() => embedOnce(spec, request));
      chain = run.catch(() => undefined);
      return run;
    },
    async close() {
      if (closed) return;
      closed = true;
      const handle = worker;
      worker = null;
      if (!handle) return;
      const exited = new Promise<void>((resolve) => handle.child.once("exit", () => resolve()));
      fail(handle, new Error("local embedding transport closed"), false);
      const timer = new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2000);
        t.unref?.();
      });
      await Promise.race([exited, timer]);
    },
  };
}
