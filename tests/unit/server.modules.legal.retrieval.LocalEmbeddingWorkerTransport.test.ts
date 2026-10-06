/**
 * W-NO-GOOGLE-02A -- LocalEmbeddingWorkerTransport (RED first).
 *
 * Real child processes, a fake worker script. The transport speaks line-delimited JSON over stdio
 * to a local worker and nothing else: no network, no cloud credentials in the child environment,
 * no silent restart that changes what runs (a restart is the same pinned runtime), and every
 * failure becomes a rejection -- never a vector.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getLocalEmbeddingPipelineByKey } from "@miljobeslut/mps-embedding-identity";
import { createLocalEmbeddingWorkerTransport } from "../../server/modules/legal/retrieval/LocalEmbeddingWorkerTransport";

const BGE = getLocalEmbeddingPipelineByKey("bge-m3")!;

const FAKE_WORKER = `
import readline from 'node:readline';
import fs from 'node:fs';
const mode = process.argv[2] ?? 'ok';
const dump = process.argv[3];
if (dump) fs.writeFileSync(dump, JSON.stringify({ pid: process.pid, env: process.env, args: process.argv.slice(2) }));
const runtime = (extra = {}) => ({
  model_key: 'bge-m3',
  hf_repo: 'BAAI/bge-m3', hf_revision: '5617a9f61b028005a4858fdac845db406aefb181',
  pipeline_version: 'local-st-bge-m3-dense-v1', dimension: 1024, normalization: 'l2',
  device: 'cuda:0', dtype: 'float16', max_seq_length: 8192, truncated_count: 0,
  snapshot_revision: '5617a9f61b028005a4858fdac845db406aefb181', snapshot_manifest_sha256: 'f'.repeat(64),
  interpreter_realpath: process.execPath,
  library_versions: { torch: 'fake' }, ...extra,
});
const unit = (i) => { const v = new Array(1024).fill(0); v[i % 1024] = 1; return v; };
if (mode === 'exit-before-ready') process.exit(3);
if (mode !== 'never-ready') console.log(JSON.stringify({ type: 'ready', runtime: runtime() }));
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const req = JSON.parse(line);
  if (mode === 'exit-on-request') process.exit(7);
  if (mode === 'hang') return;
  if (mode === 'garbage') { console.log('this is not json'); return; }
  if (mode === 'null') { console.log('null'); return; }
  if (mode === 'array') { console.log('[1, 2, 3]'); return; }
  if (mode === 'number') { console.log('42'); return; }
  if (mode === 'result-without-runtime') { console.log(JSON.stringify({ id: req.id, type: 'result', vectors: req.texts.map((_t, i) => unit(i)) })); return; }
  if (mode === 'result-without-vectors') { console.log(JSON.stringify({ id: req.id, type: 'result', runtime: runtime() })); return; }
  if (mode === 'error') { console.log(JSON.stringify({ id: req.id, type: 'error', message: 'boom: model not found' })); return; }
  if (mode === 'wrong-id') { console.log(JSON.stringify({ id: req.id + 100, type: 'result', runtime: runtime(), vectors: req.texts.map((_t, i) => unit(i)) })); return; }
  console.log(JSON.stringify({ id: req.id, type: 'result', runtime: runtime(), vectors: req.texts.map((_t, i) => unit(i)), echo: { role: req.role, max_seq_length: req.max_seq_length } }));
});
rl.on('close', () => process.exit(0));
`;

const created: string[] = [];
const transports: Array<{ close?: () => Promise<void> }> = [];

function workerFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimer-fake-embed-worker-"));
  created.push(dir);
  const file = path.join(dir, "worker.mjs");
  fs.writeFileSync(file, FAKE_WORKER, "utf8");
  return file;
}

const INTERPRETER_DIR = path.join(os.tmpdir(), "mimer-fake-python-dir");

interface SpawnLog {
  /** Every child this transport started, in order. */
  readonly children: ChildProcess[];
  /** How many earlier children were still running at the moment each new one was started. */
  readonly aliveAtSpawn: number[];
}

function makeTransport(
  mode: string,
  opts: { dump?: string; timeoutMs?: number; startupTimeoutMs?: number; restartBudget?: number; log?: SpawnLog } = {},
) {
  const file = workerFile();
  const t = createLocalEmbeddingWorkerTransport({
    interpreterDir: INTERPRETER_DIR,
    hfHome: path.join(os.tmpdir(), "mimer-fake-hf-home"),
    device: "cuda",
    timeoutMs: opts.timeoutMs ?? 5000,
    startupTimeoutMs: opts.startupTimeoutMs ?? 5000,
    ...(opts.restartBudget === undefined ? {} : { restartBudget: opts.restartBudget }),
    // The injected starter gets the exact environment the transport built for the child.
    spawnWorker: (env) => {
      opts.log?.aliveAtSpawn.push(opts.log.children.filter((c) => c.exitCode === null && c.signalCode === null).length);
      const child = spawn(process.execPath, [file, mode, ...(opts.dump ? [opts.dump] : [])], { env: { ...env }, stdio: ["pipe", "pipe", "pipe"] });
      opts.log?.children.push(child);
      return child;
    },
  });
  transports.push(t);
  return t;
}

function newLog(): SpawnLog {
  return { children: [], aliveAtSpawn: [] };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  for (const t of transports.splice(0)) await t.close?.();
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("LocalEmbeddingWorkerTransport", () => {
  it("round-trips a batch over stdio and returns the worker's runtime report and vectors", async () => {
    const t = makeTransport("ok");
    const res = await t.embed(BGE, { role: "query", texts: ["a", "b"], max_seq_length: null });
    expect(res.vectors).toHaveLength(2);
    expect(res.vectors[0]).toHaveLength(1024);
    expect(res.runtime.hf_revision).toBe(BGE.hf_revision);
    expect(res.runtime.device).toBe("cuda:0");
  });

  it("matches concurrent calls to their own responses (requests are serialised, ids never cross)", async () => {
    const t = makeTransport("ok");
    const [a, b] = await Promise.all([
      t.embed(BGE, { role: "query", texts: ["1", "2", "3"], max_seq_length: null }),
      t.embed(BGE, { role: "passage", texts: ["x"], max_seq_length: null }),
    ]);
    expect(a.vectors).toHaveLength(3);
    expect(b.vectors).toHaveLength(1);
  });

  it("rejects when the worker answers with an error message", async () => {
    const t = makeTransport("error");
    await expect(t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null })).rejects.toThrow(/boom: model not found/);
  });

  it("rejects when the worker dies during a request, and a later call starts a fresh worker of the same pinned runtime", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimer-fake-embed-dump-"));
    created.push(dir);
    const dump = path.join(dir, "dump.json");
    const t = makeTransport("exit-on-request", { dump });
    await expect(t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null })).rejects.toThrow(/exit|closed|code 7/i);
    const firstPid = JSON.parse(fs.readFileSync(dump, "utf8")).pid as number;
    await expect(t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null })).rejects.toThrow();
    const secondPid = JSON.parse(fs.readFileSync(dump, "utf8")).pid as number;
    expect(secondPid).not.toBe(firstPid);
  });

  it("times out a hung worker, rejects, and kills the child (no orphan)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimer-fake-embed-dump-"));
    created.push(dir);
    const dump = path.join(dir, "dump.json");
    const t = makeTransport("hang", { dump, timeoutMs: 300 });
    await expect(t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null })).rejects.toThrow(/timeout|timed out/i);
    const pid = JSON.parse(fs.readFileSync(dump, "utf8")).pid as number;
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(pid)).toBe(false);
  });

  it("rejects when the worker exits before it is ready", async () => {
    const t = makeTransport("exit-before-ready");
    await expect(t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null })).rejects.toThrow(/before ready|exit/i);
  });

  it("rejects when the worker never becomes ready within the startup timeout", async () => {
    const t = makeTransport("never-ready", { startupTimeoutMs: 300 });
    await expect(t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null })).rejects.toThrow(/startup|ready|timeout/i);
  });

  it("rejects malformed worker output instead of guessing", async () => {
    const t = makeTransport("garbage");
    await expect(t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null })).rejects.toThrow();
  });

  it("rejects a response that does not belong to the request", async () => {
    const t = makeTransport("wrong-id", { timeoutMs: 500 });
    await expect(t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null })).rejects.toThrow();
  });

  it("starts the child with an allowlisted environment: offline flags set, no cloud credentials inherited", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimer-fake-embed-dump-"));
    created.push(dir);
    const dump = path.join(dir, "dump.json");
    const saved = { ...process.env };
    process.env.GEMINI_API_KEY = "must-not-leak";
    process.env.GOOGLE_API_KEY = "must-not-leak";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "C:\\must\\not\\leak.json";
    process.env.AWS_SECRET_ACCESS_KEY = "must-not-leak";
    process.env.DATABASE_URL = "postgresql://must-not-leak";
    try {
      const t = makeTransport("ok", { dump });
      await t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null });
    } finally {
      process.env = saved;
    }
    const childEnv = JSON.parse(fs.readFileSync(dump, "utf8")).env as Record<string, string>;
    for (const name of Object.keys(childEnv)) {
      expect(name).not.toMatch(/^(GEMINI|GOOGLE|AWS|AZURE|DATABASE|VERTEX|GCP|GCLOUD)/i);
    }
    expect(JSON.stringify(childEnv)).not.toContain("must-not-leak");
    expect(childEnv.HF_HUB_OFFLINE).toBe("1");
    expect(childEnv.TRANSFORMERS_OFFLINE).toBe("1");
    expect(childEnv.HF_HOME).toBe(path.join(os.tmpdir(), "mimer-fake-hf-home"));
  });

  // Repair round A4/A5: Node sends a CLOSED model key. The worker owns the mapping key -> repo/revision/pipeline,
  // so a caller can never assert provenance by environment and have it echoed back.
  it("hands the worker a closed model KEY only -- never a repo, a revision or a pipeline to echo back", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimer-fake-embed-dump-"));
    created.push(dir);
    const dump = path.join(dir, "dump.json");
    const t = makeTransport("ok", { dump });
    await t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null });
    const childEnv = JSON.parse(fs.readFileSync(dump, "utf8")).env as Record<string, string>;
    expect(childEnv.MIMER_EMBED_MODEL_KEY).toBe("bge-m3");
    expect(childEnv.MIMER_EMBED_DEVICE).toBe("cuda");
    for (const forbidden of ["MIMER_EMBED_REPO", "MIMER_EMBED_REVISION", "MIMER_EMBED_PIPELINE", "MIMER_EMBED_DIMENSION"]) {
      expect(Object.keys(childEnv), forbidden).not.toContain(forbidden);
    }
    expect(JSON.stringify(childEnv)).not.toContain(BGE.hf_revision);
  });

  // Repair round A6: the configured interpreter is the ONLY place `python` can resolve from.
  it("puts the configured interpreter directory alone on the child's PATH: the parent's PATH is not inherited", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimer-fake-embed-dump-"));
    created.push(dir);
    const dump = path.join(dir, "dump.json");
    const t = makeTransport("ok", { dump });
    await t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null });
    const childEnv = JSON.parse(fs.readFileSync(dump, "utf8")).env as Record<string, string>;
    const pathKeys = Object.keys(childEnv).filter((k) => k.toUpperCase() === "PATH");
    expect(pathKeys).toHaveLength(1);
    expect(childEnv[pathKeys[0]!]).toBe(INTERPRETER_DIR);
  });

  it("refuses to serve a second model: one transport is bound to the model it started with", async () => {
    const t = makeTransport("ok");
    const E5 = getLocalEmbeddingPipelineByKey("multilingual-e5-large")!;
    await t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null });
    await expect(t.embed(E5, { role: "query", texts: ["a"], max_seq_length: null })).rejects.toThrow(/bound to 'bge-m3'/);
  });

  it("terminates the child on close()", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimer-fake-embed-dump-"));
    created.push(dir);
    const dump = path.join(dir, "dump.json");
    const t = makeTransport("ok", { dump });
    await t.embed(BGE, { role: "query", texts: ["a"], max_seq_length: null });
    const pid = JSON.parse(fs.readFileSync(dump, "utf8")).pid as number;
    expect(alive(pid)).toBe(true);
    await t.close?.();
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(pid)).toBe(false);
  });
});

const REQ = { role: "query", texts: ["a"], max_seq_length: null } as const;

// Repair round A1 -- a bounded worker lifecycle: one worker, never one per request, a defined shutdown, and a
// crash that fails closed and never leaves two workers (or a mock, or a cloud call) in its place.
describe("LocalEmbeddingWorkerTransport -- bounded lifecycle", () => {
  it("serves 20 sequential requests with exactly one worker (no worker per request)", async () => {
    const log = newLog();
    const t = makeTransport("ok", { log });
    for (let i = 0; i < 20; i++) await t.embed(BGE, REQ);
    expect(log.children).toHaveLength(1);
  });

  it("serves 12 concurrent requests with exactly one worker and answers each its own batch", async () => {
    const log = newLog();
    const t = makeTransport("ok", { log });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_v, i) => t.embed(BGE, { role: "passage", texts: Array.from({ length: i + 1 }, () => "x"), max_seq_length: null })),
    );
    results.forEach((r, i) => expect(r.vectors).toHaveLength(i + 1));
    expect(log.children).toHaveLength(1);
  });

  it("shutdown: close() ends the worker, is idempotent, and a request after shutdown is refused without starting anything", async () => {
    const log = newLog();
    const t = makeTransport("ok", { log });
    await t.embed(BGE, REQ);
    await t.close?.();
    await t.close?.();
    expect(log.children[0]!.exitCode !== null || log.children[0]!.signalCode !== null).toBe(true);
    await expect(t.embed(BGE, REQ)).rejects.toThrow(/closed|shut ?down/i);
    expect(log.children).toHaveLength(1);
  });

  it("a crash fails closed: the request rejects, and the replacement starts only after the crashed worker is gone", async () => {
    const log = newLog();
    const t = makeTransport("exit-on-request", { log });
    await expect(t.embed(BGE, REQ)).rejects.toThrow();
    await expect(t.embed(BGE, REQ)).rejects.toThrow();
    expect(log.children).toHaveLength(2);
    expect(log.aliveAtSpawn).toEqual([0, 0]);
  });

  it("a worker that keeps failing is latched after the restart budget: no further worker is ever started in this process", async () => {
    const log = newLog();
    const t = makeTransport("exit-before-ready", { log, restartBudget: 2 });
    for (let i = 0; i < 3; i++) await expect(t.embed(BGE, REQ)).rejects.toThrow();
    expect(log.children).toHaveLength(3);
    await expect(t.embed(BGE, REQ)).rejects.toThrow(/budget|no further worker|latched/i);
    await expect(t.embed(BGE, REQ)).rejects.toThrow(/budget|no further worker|latched/i);
    expect(log.children).toHaveLength(3);
  });

  it("a restart budget of 0 means a single failure latches immediately", async () => {
    const log = newLog();
    const t = makeTransport("exit-on-request", { log, restartBudget: 0 });
    await expect(t.embed(BGE, REQ)).rejects.toThrow();
    await expect(t.embed(BGE, REQ)).rejects.toThrow(/budget|no further worker|latched/i);
    expect(log.children).toHaveLength(1);
  });

  it("a hung worker is killed on timeout and counts as a failure (the worker is not left running)", async () => {
    const log = newLog();
    const t = makeTransport("hang", { log, timeoutMs: 250 });
    await expect(t.embed(BGE, REQ)).rejects.toThrow(/timed out/i);
    await new Promise((r) => setTimeout(r, 300));
    expect(log.children[0]!.exitCode !== null || log.children[0]!.signalCode !== null).toBe(true);
  });
});

// Repair round A7 -- a null / malformed worker line must fail that request and that worker, cleanly. It must
// never throw out of the readline callback (an uncaught exception there would take the whole server down).
describe("LocalEmbeddingWorkerTransport -- protocol safety", () => {
  it.each(["null", "array", "number", "garbage", "result-without-runtime", "result-without-vectors"])(
    "worker output '%s' rejects the request, kills the worker, and does not crash the process",
    async (mode) => {
      const uncaught: unknown[] = [];
      const onUncaught = (error: unknown) => uncaught.push(error);
      process.on("uncaughtException", onUncaught);
      try {
        const log = newLog();
        const t = makeTransport(mode, { log, timeoutMs: 2000 });
        await expect(t.embed(BGE, REQ)).rejects.toThrow();
        await new Promise((r) => setTimeout(r, 300));
        expect(log.children[0]!.exitCode !== null || log.children[0]!.signalCode !== null).toBe(true);
        expect(uncaught).toEqual([]);
      } finally {
        process.off("uncaughtException", onUncaught);
      }
    },
  );
});
