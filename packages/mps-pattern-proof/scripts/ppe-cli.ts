/**
 * PATTERN-PROOF-ENGINE-01 V1 -- engine CLI (plan section 1, D3; BOOTSTRAP design section 4).
 *
 *   npx tsx packages/mps-pattern-proof/scripts/ppe-cli.ts validate --kind <kind> [--file <path>]
 *       reads JSON from --file or stdin, runs the package validator for <kind>
 *       stdout {"ok":true,"kind":..,"digest":..} exit 0 | {"ok":false,"errors":[{code,message,path}]} exit 1
 *
 *   npx tsx packages/mps-pattern-proof/scripts/ppe-cli.ts run --dir <dir> --mode BOOTSTRAP_RED_ONLY
 *       [--repo-root <root>=cwd] [--run-id <id>] [--base-sha <sha>] [--ledger <file>] [--out <file>=<dir>/run-state.json] [--json]
 *       replays <dir>/discovery.json, dependency-graph.json, decision-gate.json and red-plan.json (the
 *       proposed probes; optional only when the gate stops earlier) through the PURE state machine
 *       (driveBootstrapSequence) with a RepositoryAuthorityResolver rooted at --repo-root and a
 *       runtime_result ledger from <dir>/runtime-ledger.json (JSON array of strings) or --ledger.
 *       Writes the full run state to --out and prints the summary. This output is the authoritative
 *       transition (phase / terminal / stoppedByMode); the orchestrator adapter never duplicates it.
 *       exit 0 stoppedByMode at RED_SYNTHESIS | 3 terminal state reached (an evidenced, legitimate stop)
 *            1 an artifact was inadmissible (PatternProofError; code + message printed as JSON)
 *            2 harness fault (missing file, unreadable JSON, wrong mode, unexpected error)
 *
 *   npx tsx packages/mps-pattern-proof/scripts/ppe-cli.ts schemas [--kind <kind>]
 *       prints PPE_ARTIFACT_SCHEMAS (or one kind) as JSON.
 *
 * Any mode other than BOOTSTRAP_RED_ONLY is refused (exit 2) quoting BOOTSTRAP design section 7.
 * This script produces evidence only: it never mints authority and never writes anything but the
 * run-state file named by --out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RepositoryAuthorityResolver } from '../src/authority';
import { isPatternProofError, PatternProofError } from '../src/errors';
import { digestOf, isPatternProofArtifactKind, PATTERN_PROOF_ARTIFACT_KINDS } from '../src/identity';
import { PPE_ARTIFACT_SCHEMAS } from '../src/schemas';
import {
  applyDecisionGate,
  applyDependencyGraph,
  applyDiscovery,
  driveBootstrapSequence,
  startPatternProofRun,
  summarizeRunState,
  type PatternProofRunState,
} from '../src/state-machine';
import { validateArtifact } from '../src/validators';

export const EXIT_OK = 0;
export const EXIT_INADMISSIBLE = 1;
export const EXIT_HARNESS = 2;
export const EXIT_TERMINAL = 3;

export const BOOTSTRAP_MODE = 'BOOTSTRAP_RED_ONLY';

/** BOOTSTRAP design section 7, quoted: why any other mode is refused here. */
export const MODE_REFUSAL =
  'BOOTSTRAP design section 7: "`FULL_PATTERN_PROOF` (writer builds a Docker candidate -> freeze -> fresh ' +
  'verifier -> adversarial probes -> clean-room replay -> `ProofPackage`) is a separate, later unit requiring ' +
  'its own review and its own separate go -- not taken by this session, and not triggered automatically by ' +
  '`BOOTSTRAP_RED_ONLY` completing." This CLI implements BOOTSTRAP_RED_ONLY only.';

export const RUN_INPUT_FILES = {
  discovery: 'discovery.json',
  dependencyGraph: 'dependency-graph.json',
  decisionGate: 'decision-gate.json',
  redPlan: 'red-plan.json',
  runtimeLedger: 'runtime-ledger.json',
  runState: 'run-state.json',
} as const;

class HarnessFault extends Error {
  readonly code = 'PPE_CLI_HARNESS';

  constructor(message: string) {
    super(message);
    this.name = 'HarnessFault';
  }
}

interface ParsedArgs {
  readonly command: string;
  readonly values: Readonly<Record<string, string>>;
  readonly flags: ReadonlySet<string>;
}

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['json']);

function usage(): string {
  return [
    'usage: ppe-cli.ts validate --kind <kind> [--file <path>]',
    '       ppe-cli.ts run --dir <dir> --mode BOOTSTRAP_RED_ONLY [--repo-root <root>] [--run-id <id>] [--base-sha <sha>]',
    '                      [--ledger <file>] [--out <file>] [--json]',
    '       ppe-cli.ts schemas [--kind <kind>]',
    `kinds: ${PATTERN_PROOF_ARTIFACT_KINDS.join(', ')}`,
  ].join('\n');
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command === undefined || command.startsWith('--'))
    throw new HarnessFault(`missing command\n${usage()}`);
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let k = 0; k < rest.length; k += 1) {
    const arg = rest[k];
    if (!arg.startsWith('--')) throw new HarnessFault(`unexpected argument "${arg}"\n${usage()}`);
    const name = arg.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.add(name);
      continue;
    }
    const value = rest[k + 1];
    if (value === undefined || value.startsWith('--'))
      throw new HarnessFault(`missing value for ${arg}\n${usage()}`);
    values[name] = value;
    k += 1;
  }
  return { command, values, flags };
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function errorRecord(error: PatternProofError): { code: string; message: string; path?: string } {
  const record: { code: string; message: string; path?: string } = {
    code: error.code,
    message: error.message,
  };
  if (error.path !== undefined) record.path = error.path;
  return record;
}

function readJsonFile(file: string, label: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new HarnessFault(`cannot read ${label} (${file}): ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new HarnessFault(`cannot parse ${label} (${file}) as JSON: ${(error as Error).message}`);
  }
}

function readJsonInput(file: string | undefined): unknown {
  if (file !== undefined) return readJsonFile(path.resolve(file), '--file');
  let text: string;
  try {
    text = fs.readFileSync(0, 'utf8');
  } catch (error) {
    throw new HarnessFault(`cannot read stdin: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new HarnessFault(`cannot parse stdin as JSON: ${(error as Error).message}`);
  }
}

function requireKind(value: string | undefined): (typeof PATTERN_PROOF_ARTIFACT_KINDS)[number] {
  if (value === undefined) throw new HarnessFault(`--kind is required\n${usage()}`);
  if (!isPatternProofArtifactKind(value))
    throw new HarnessFault(`unknown artifact kind "${value}"\n${usage()}`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------------------------

function commandValidate(parsed: ParsedArgs): number {
  const kind = requireKind(parsed.values.kind);
  const input = readJsonInput(parsed.values.file);
  try {
    const validated = validateArtifact(kind, input);
    print({ ok: true, kind, digest: digestOf(validated) });
    return EXIT_OK;
  } catch (error) {
    if (isPatternProofError(error)) {
      print({ ok: false, kind, errors: [errorRecord(error)] });
      return EXIT_INADMISSIBLE;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------

function readLedger(file: string, label: string): readonly string[] {
  const parsed = readJsonFile(file, label);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new HarnessFault(`${label} (${file}) must be a JSON array of strings`);
  }
  return parsed as string[];
}

export interface RunSummaryOutput {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly runId: string;
  readonly mode: string;
  readonly phase: string;
  readonly stoppedAtPhase?: string;
  readonly stoppedByMode?: PatternProofRunState['stoppedByMode'];
  readonly terminalState?: string;
  readonly terminal?: PatternProofRunState['terminal'];
  readonly storedArtifacts: readonly string[];
  readonly runStateFile: string;
}

function summarize(state: PatternProofRunState, outFile: string): RunSummaryOutput {
  const summary = summarizeRunState(state);
  const base = {
    runId: summary.runId,
    mode: summary.mode,
    phase: summary.phase,
    storedArtifacts: summary.storedArtifacts,
    runStateFile: outFile,
  };
  if (summary.terminal !== undefined) {
    return {
      ok: true,
      exitCode: EXIT_TERMINAL,
      ...base,
      terminalState: summary.terminal.state,
      terminal: summary.terminal,
    };
  }
  if (summary.stoppedByMode !== undefined) {
    return {
      ok: true,
      exitCode: EXIT_OK,
      ...base,
      stoppedAtPhase: summary.stoppedByMode.atPhase,
      stoppedByMode: summary.stoppedByMode,
    };
  }
  // Unreachable in BOOTSTRAP_RED_ONLY (the machine either stops by mode or terminally); fail closed.
  return { ok: false, exitCode: EXIT_HARNESS, ...base };
}

async function commandRun(parsed: ParsedArgs): Promise<number> {
  const mode = parsed.values.mode;
  if (mode === undefined) throw new HarnessFault(`--mode is required\n${usage()}`);
  if (mode !== BOOTSTRAP_MODE) {
    throw new HarnessFault(`refused: --mode ${mode} is not ${BOOTSTRAP_MODE}. ${MODE_REFUSAL}`);
  }
  if (parsed.values.dir === undefined) throw new HarnessFault(`--dir is required\n${usage()}`);
  const dir = path.resolve(parsed.values.dir);
  const repoRoot = path.resolve(parsed.values['repo-root'] ?? process.cwd());
  const runId = parsed.values['run-id'] ?? `ppe-cli-run:${path.basename(dir)}`;
  const baseSha = parsed.values['base-sha'];
  if (baseSha !== undefined && !/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new HarnessFault(`--base-sha must be a 40-hex git sha, got ${baseSha}`);
  }
  const outFile = path.resolve(parsed.values.out ?? path.join(dir, RUN_INPUT_FILES.runState));
  const json = parsed.flags.has('json');

  const discovery = readJsonFile(path.join(dir, RUN_INPUT_FILES.discovery), 'discovery artifact');
  const dependencyGraph = readJsonFile(
    path.join(dir, RUN_INPUT_FILES.dependencyGraph),
    'dependency-graph artifact',
  );
  const decisionGate = readJsonFile(path.join(dir, RUN_INPUT_FILES.decisionGate), 'decision-gate artifact');
  const redPlanFile = path.join(dir, RUN_INPUT_FILES.redPlan);
  const redPlanPresent = fs.existsSync(redPlanFile);
  const proposedProbes = redPlanPresent ? readJsonFile(redPlanFile, 'red-plan (proposed probes)') : undefined;

  const ledgerFile = parsed.values.ledger === undefined ? undefined : path.resolve(parsed.values.ledger);
  const defaultLedgerFile = path.join(dir, RUN_INPUT_FILES.runtimeLedger);
  let runtimeLedger: readonly string[] | undefined;
  if (ledgerFile !== undefined) runtimeLedger = readLedger(ledgerFile, '--ledger');
  else if (fs.existsSync(defaultLedgerFile)) runtimeLedger = readLedger(defaultLedgerFile, 'runtime ledger');

  const resolver = new RepositoryAuthorityResolver({
    repoRoot,
    ...(runtimeLedger === undefined ? {} : { runtimeLedger }),
  });

  let state: PatternProofRunState;
  try {
    if (redPlanPresent) {
      state = await driveBootstrapSequence(
        {
          runId,
          mode: BOOTSTRAP_MODE,
          ...(baseSha === undefined ? {} : { baseSha }),
          discovery,
          dependencyGraph,
          decisionGate,
          proposedProbes,
        },
        resolver,
      );
    } else {
      // No proposed probes on disk: replay up to the gate; only a terminal stop there is legitimate.
      state = startPatternProofRun({
        runId,
        mode: BOOTSTRAP_MODE,
        ...(baseSha === undefined ? {} : { baseSha }),
      });
      state = applyDiscovery(state, discovery);
      state = applyDependencyGraph(state, dependencyGraph);
      state = applyDecisionGate(state, decisionGate);
      if (state.terminal === undefined) {
        throw new HarnessFault(
          `${RUN_INPUT_FILES.redPlan} is missing in ${dir} and the decision gate did not stop the run (phase ${state.phase})`,
        );
      }
    }
  } catch (error) {
    if (isPatternProofError(error)) {
      const record = {
        ok: false,
        exitCode: EXIT_INADMISSIBLE,
        runId,
        mode: BOOTSTRAP_MODE,
        error: errorRecord(error),
      };
      print(record);
      return EXIT_INADMISSIBLE;
    }
    throw error;
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(state, null, 2)}\n`);

  const summary = summarize(state, outFile);
  if (!json) {
    const detail =
      summary.terminalState !== undefined
        ? `terminal ${summary.terminalState} at ${summary.terminal?.atPhase ?? summary.phase}`
        : summary.stoppedAtPhase !== undefined
          ? `stopped by mode ${BOOTSTRAP_MODE} at ${summary.stoppedAtPhase}`
          : `phase ${summary.phase} (no stop recorded)`;
    process.stderr.write(`ppe-cli run ${runId}: ${detail}; run state written to ${outFile}\n`);
  }
  print(summary);
  return summary.exitCode;
}

// ---------------------------------------------------------------------------------------------
// schemas
// ---------------------------------------------------------------------------------------------

function commandSchemas(parsed: ParsedArgs): number {
  if (parsed.values.kind === undefined) {
    print(PPE_ARTIFACT_SCHEMAS);
  } else {
    print(PPE_ARTIFACT_SCHEMAS[requireKind(parsed.values.kind)]);
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------------------------

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  switch (parsed.command) {
    case 'validate':
      return commandValidate(parsed);
    case 'run':
      return commandRun(parsed);
    case 'schemas':
      return commandSchemas(parsed);
    default:
      throw new HarnessFault(`unknown command "${parsed.command}"\n${usage()}`);
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof HarnessFault ? error.code : 'PPE_CLI_UNEXPECTED';
    print({ ok: false, exitCode: EXIT_HARNESS, error: { code, message } });
    process.exitCode = EXIT_HARNESS;
  });
