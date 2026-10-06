/**
 * W-NO-GOOGLE-02A -- stdio transport to the local embedding worker.
 *
 * One long-lived child process per transport (loading a model takes seconds, so a process per
 * request would be useless), spoken to in line-delimited JSON over stdin/stdout. Requests are
 * serialised: exactly one is in flight.
 *
 * Containment, because this is the only place the provider touches a process boundary:
 * - the child gets an ALLOWLISTED environment (system basics plus the offline Hugging Face
 *   settings); nothing else of the parent's environment -- no API keys, no database settings, no
 *   cloud credentials -- is inherited;
 * - the child is forced offline (HF_HUB_OFFLINE, TRANSFORMERS_OFFLINE);
 * - any defect (exit, timeout, malformed output, a response that is not for the request) kills the
 *   child and rejects the call. A later call starts a fresh child of the SAME pinned runtime; that is
 *   a restart, not a fallback -- the transport is bound to one model and refuses to serve another.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { LocalEmbeddingPipelineSpec } from "@miljobeslut/mps-embedding-identity";
import type {
  LocalEmbeddingRuntimeReport,
  LocalEmbeddingTransport,
  LocalEmbeddingWireRequest,
  LocalEmbeddingWireResponse,
} from "./LocalEmbeddingProvider";

export interface LocalEmbeddingWorkerTransportOptions {
  /** Executable to start (the pinned runtime's interpreter). */
  readonly command: string;
  readonly buildArgs: (spec: LocalEmbeddingPipelineSpec) => readonly string[];
  readonly hfHome: string;
  readonly device: "cuda" | "cpu";
  /** Timeout of one request, in milliseconds. */
  readonly timeoutMs: number;
  /** How long the worker may take to load the model and announce itself ready. */
  readonly startupTimeoutMs: number;
}

/** Variables the child may inherit. Matched case-insensitively (Windows keeps its own casing). */
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

export function buildWorkerEnvironment(
  hfHome: string,
  parent: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined && INHERITED_ENV_KEYS.has(name.toUpperCase())) env[name] = value;
  }
  return {
    ...env,
    HF_HOME: hfHome,
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    TOKENIZERS_PARALLELISM: "false",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
  };
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
  /** Tail of the child's stderr, kept for error messages. */
  stderrTail: string;
  failed: boolean;
  nextId: number;
}

const STDERR_TAIL_BYTES = 2000;

export function createLocalEmbeddingWorkerTransport(
  options: LocalEmbeddingWorkerTransportOptions,
): LocalEmbeddingTransport {
  let worker: WorkerHandle | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  function fail(handle: WorkerHandle, error: Error): void {
    if (handle.failed) return;
    handle.failed = true;
    if (worker === handle) worker = null;
    for (const p of handle.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    handle.pending.clear();
    try {
      handle.child.kill();
    } catch {
      /* already gone */
    }
  }

  function start(spec: LocalEmbeddingPipelineSpec): WorkerHandle {
    const child = spawn(options.command, [...options.buildArgs(spec)], {
      env: buildWorkerEnvironment(options.hfHome),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
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

    child.stderr.on("data", (chunk: Buffer) => {
      handle.stderrTail = (handle.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (handle.failed) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        const error = new Error("local embedding worker produced malformed output (not JSON)");
        rejectReady(error);
        fail(handle, error);
        return;
      }
      if (message.type === "ready") {
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
        pending.resolve({
          runtime: message.runtime as LocalEmbeddingRuntimeReport,
          vectors: message.vectors as readonly (readonly number[])[],
        });
        return;
      }
      fail(handle, new Error(`local embedding worker sent an unknown message type '${String(message.type)}'`));
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
    // A closed stdin pipe must not crash the process; the exit/timeout paths report it.
    child.stdin.on("error", () => undefined);

    return handle;
  }

  async function embedOnce(spec: LocalEmbeddingPipelineSpec, request: LocalEmbeddingWireRequest): Promise<LocalEmbeddingWireResponse> {
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
      const handle = worker;
      if (!handle) return;
      const exited = new Promise<void>((resolve) => handle.child.once("exit", () => resolve()));
      fail(handle, new Error("local embedding transport closed"));
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
    },
  };
}
