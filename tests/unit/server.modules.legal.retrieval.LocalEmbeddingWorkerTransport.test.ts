/**
 * W-NO-GOOGLE-02A -- LocalEmbeddingWorkerTransport (RED first).
 *
 * Real child processes, a fake worker script. The transport speaks line-delimited JSON over stdio
 * to a local worker and nothing else: no network, no cloud credentials in the child environment,
 * no silent restart that changes what runs (a restart is the same pinned runtime), and every
 * failure becomes a rejection -- never a vector.
 */
import { afterEach, describe, expect, it } from "vitest";
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
  hf_repo: 'BAAI/bge-m3', hf_revision: '5617a9f61b028005a4858fdac845db406aefb181',
  pipeline_version: 'local-st-bge-m3-dense-v1', dimension: 1024, normalization: 'l2',
  device: 'cuda:0', dtype: 'float16', max_seq_length: 8192, truncated_count: 0,
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

function makeTransport(mode: string, opts: { dump?: string; timeoutMs?: number; startupTimeoutMs?: number } = {}) {
  const file = workerFile();
  const t = createLocalEmbeddingWorkerTransport({
    command: process.execPath,
    buildArgs: () => [file, mode, ...(opts.dump ? [opts.dump] : [])],
    hfHome: path.join(os.tmpdir(), "mimer-fake-hf-home"),
    device: "cuda",
    timeoutMs: opts.timeoutMs ?? 5000,
    startupTimeoutMs: opts.startupTimeoutMs ?? 5000,
  });
  transports.push(t);
  return t;
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
