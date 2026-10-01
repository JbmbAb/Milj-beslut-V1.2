/**
 * PATTERN-PROOF-ENGINE-01 V1 -- RED probe CLI (plan section 1, T1, T10).
 *
 *   npx tsx packages/mps-pattern-proof/scripts/red-probe.ts --stage production-base [--dockerfile Dockerfile]
 *       [--executor docker|host|auto] [--timeout-ms 780000] [--json] [--out <file>] [--ca-bundle <path>]
 *
 * Exit codes: 0 PASS, 1 FAIL (RED confirmed), 2 BLOCKED (also 2 on any thrown error, printed to stderr).
 * Environment: PPE_DOCKER_CA_BUNDLE (default for --ca-bundle); DOCKER_HOST is honored by the docker CLI
 * itself and is never set by this script.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_RED_PROBE_TIMEOUT_MS,
  executeRedProbe,
  type RedProbeExecutionResult,
  type RedProbeExecutorChoice,
} from '../src/docker/red-probe';

interface CliArgs {
  readonly dockerfile: string;
  readonly stage: string;
  readonly executor: RedProbeExecutorChoice;
  readonly timeoutMs: number;
  readonly json: boolean;
  readonly out?: string;
  readonly caBundle?: string;
  readonly repoRoot: string;
}

const EXIT_BY_CLASSIFICATION: Readonly<Record<RedProbeExecutionResult['classification'], number>> = {
  PASS: 0,
  FAIL: 1,
  BLOCKED: 2,
};

function usage(): string {
  return [
    'usage: red-probe.ts --stage <name> [--dockerfile <path>] [--executor docker|host|auto]',
    '                    [--timeout-ms <n>] [--json] [--out <file>] [--ca-bundle <path>] [--repo-root <dir>]',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values: Record<string, string> = {};
  let json = false;
  for (let k = 0; k < argv.length; k += 1) {
    const arg = argv[k];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"\n${usage()}`);
    const value = argv[k + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`missing value for ${arg}\n${usage()}`);
    values[arg.slice(2)] = value;
    k += 1;
  }
  const stage = values.stage;
  if (stage === undefined || stage.length === 0) throw new Error(`--stage is required\n${usage()}`);
  const executor = values.executor ?? 'auto';
  if (executor !== 'docker' && executor !== 'host' && executor !== 'auto') {
    throw new Error(`--executor must be docker|host|auto, got "${executor}"`);
  }
  const timeoutMs =
    values['timeout-ms'] === undefined ? DEFAULT_RED_PROBE_TIMEOUT_MS : Number(values['timeout-ms']);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('--timeout-ms must be a positive integer');
  const caBundle = values['ca-bundle'] ?? process.env.PPE_DOCKER_CA_BUNDLE;
  const args: {
    dockerfile: string;
    stage: string;
    executor: RedProbeExecutorChoice;
    timeoutMs: number;
    json: boolean;
    out?: string;
    caBundle?: string;
    repoRoot: string;
  } = {
    dockerfile: values.dockerfile ?? 'Dockerfile',
    stage,
    executor,
    timeoutMs,
    json,
    repoRoot: path.resolve(values['repo-root'] ?? process.cwd()),
  };
  if (values.out !== undefined) args.out = path.resolve(values.out);
  if (caBundle !== undefined && caBundle.length > 0) args.caBundle = caBundle;
  return args;
}

function summaryLine(result: RedProbeExecutionResult): string {
  return `${result.classification} ${result.reasonCode} probe=${result.probeId} stage=${result.stageName} fidelity=${result.fidelity} executor=${result.executorUsed} elapsedMs=${result.elapsedMs}`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const result = await executeRedProbe({
    repoRoot: args.repoRoot,
    dockerfilePath: args.dockerfile,
    stageName: args.stage,
    executor: args.executor,
    timeoutMs: args.timeoutMs,
    ...(args.caBundle === undefined ? {} : { caBundlePath: args.caBundle }),
  });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out !== undefined) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, serialized);
  }
  if (args.json) process.stdout.write(serialized);
  process.stderr.write(`${summaryLine(result)}\n`);
  return EXIT_BY_CLASSIFICATION[result.classification];
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const err = error as { code?: unknown; message?: unknown };
    const code = typeof err?.code === 'string' ? `${err.code}: ` : '';
    const message = typeof err?.message === 'string' ? err.message : String(error);
    process.stderr.write(`BLOCKED ${code}${message}\n`);
    process.exitCode = 2;
  });
