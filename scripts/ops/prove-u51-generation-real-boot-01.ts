/**
 * U51-GENERATION-REAL-BOOT-PROBE-01.
 *
 * Boots every composition-derived production entrypoint of one exact commit and, only when each one
 * reaches its own refusal without an isolation trip, writes a u51-generation-derivation-1 payload.
 * Evidence is written outside the subject repository. Exit 0 is EXECUTION_VERIFIED, 2 is NOT_EXECUTED,
 * 1 is a real generation-registration failure.
 *
 * Usage:
 *   npx tsx scripts/ops/prove-u51-generation-real-boot-01.ts --repo <path> --commit <rev> --out <file> [--timeout-ms <n>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runGenerationBootProof } from '../../packages/mps-u51-generation-absence/src/bootProbe/prove';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const repo = arg('repo');
const rev = arg('commit');
const out = arg('out');
const timeoutMs = Number(arg('timeout-ms') ?? 180_000);
if (!repo || !rev || !out) fail('usage: --repo <path> --commit <rev> --out <file> [--timeout-ms <n>]');
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) fail('--timeout-ms must be a number of milliseconds >= 1000');

const top = spawnSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
if (top) {
  const rel = path.relative(path.resolve(top), path.resolve(out));
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) fail(`refusing --out inside the subject repository: ${out}`);
}

const report = await runGenerationBootProof({ repo, commit: rev, timeoutMs });
const json = `${JSON.stringify(report, null, 2)}\n`;
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(out, json, 'utf8');
process.stdout.write(json);
process.exit(report.exit_code);
