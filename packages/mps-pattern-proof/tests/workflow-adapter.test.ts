/**
 * Orchestrator adapter tests (plan section 7 as amended by D2, D3, D14, T4, T5, T13):
 *  (a) drift: the generated schema block of workflow/ppe-v1.js byte-equals a fresh regeneration;
 *  (b) meta: `export const meta` is the first statement, a pure literal, name ppe-v1, four phases;
 *  (c) control flow: the script body run with stubbed Workflow globals -- refusal before any agent()
 *      for a non-BOOTSTRAP mode, happy path (4 agents in phase order), fail-closed on validation,
 *      DECISION_GATE early return on a non-MECHANICAL item, fail-closed on a bad `ppe-cli run` summary;
 *  (d) every schema in the block (and every schema the script hands to agent()) stays inside the
 *      draft-07 subset the harness is trusted to enforce and has no contradictions;
 *  (e) the file starts with the `/* global ... *\/` directive (T5).
 *
 * The script is never executed by the real Workflow runtime here: agent()/phase()/log() are stubs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  applyGeneratedBlock,
  extractGeneratedBlock,
  renderGeneratedSchemaBlock,
} from '../scripts/gen-workflow-adapter';
import {
  ADAPTER_SCHEMA_CONST_NAME,
  GENERATED_BLOCK_BEGIN_MARKER,
  GENERATED_BLOCK_END_MARKER,
} from '../src/adapter-schemas';
import { PATTERN_PROOF_ARTIFACT_KINDS } from '../src/identity';
import { PPE_ARTIFACT_SCHEMAS } from '../src/schemas';
import {
  listSchemaKeywords,
  PPE_SCHEMA_KEYWORDS,
  schemaContradictions,
  validateAgainstSubsetSchema,
  type SubsetSchema,
} from '../src/schema-subset';
import { validDiscovery, validGate, validGraph, validRedPlan } from './fixtures/artifacts';

const ADAPTER_FILE = fileURLToPath(new URL('../workflow/ppe-v1.js', import.meta.url));
const SOURCE = fs.readFileSync(ADAPTER_FILE, 'utf8');
const GLOBAL_DIRECTIVE = '/* global agent, pipeline, parallel, phase, log, args, budget, workflow */';
const PHASES = ['DISCOVER', 'BUILD_GRAPH', 'DECISION_GATE', 'RED_SYNTHESIS'] as const;
const KINDS_BY_PHASE = {
  DISCOVER: 'discovery',
  BUILD_GRAPH: 'dependency-graph',
  DECISION_GATE: 'decision-gate',
  RED_SYNTHESIS: 'red-plan',
} as const;

function parse(): ts.SourceFile {
  return ts.createSourceFile('ppe-v1.js', SOURCE, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

/** `export const meta = {...}` as the first statement; returns the declaration + initializer. */
function metaStatement(sourceFile: ts.SourceFile): {
  statement: ts.VariableStatement;
  initializer: ts.ObjectLiteralExpression;
} {
  const statement = sourceFile.statements[0];
  expect(ts.isVariableStatement(statement)).toBe(true);
  const variable = statement as ts.VariableStatement;
  const modifiers = variable.modifiers ?? [];
  expect(modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
  expect(variable.declarationList.flags & ts.NodeFlags.Const).toBeTruthy();
  const [declaration] = variable.declarationList.declarations;
  expect(declaration.name.getText(sourceFile)).toBe('meta');
  expect(declaration.initializer).toBeDefined();
  expect(ts.isObjectLiteralExpression(declaration.initializer as ts.Node)).toBe(true);
  return { statement: variable, initializer: declaration.initializer as ts.ObjectLiteralExpression };
}

const LITERAL_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);

/** True iff the node tree holds only object literals with plain property assignments, arrays and literals. */
function isPureLiteral(node: ts.Node): boolean {
  if (LITERAL_KINDS.has(node.kind)) return true;
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(isPureLiteral);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        isPureLiteral(property.initializer),
    );
  }
  return false;
}

type AsyncFunctionCtor = new (...params: string[]) => (...values: unknown[]) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async function () {
  /* prototype probe */
}).constructor as AsyncFunctionCtor;

/** The script body with the leading `export ` of the meta statement stripped, compiled as an AsyncFunction. */
function compileAdapter(): (...values: unknown[]) => Promise<unknown> {
  const sourceFile = parse();
  const { statement } = metaStatement(sourceFile);
  const exportKeyword = (statement.modifiers ?? []).find((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  expect(exportKeyword).toBeDefined();
  const start = (exportKeyword as ts.Node).getStart(sourceFile);
  const end = (exportKeyword as ts.Node).getEnd();
  const body = `${SOURCE.slice(0, start)}${SOURCE.slice(end).replace(/^\s+/, '')}`;
  return new AsyncFunction(
    'agent',
    'pipeline',
    'parallel',
    'phase',
    'log',
    'args',
    'budget',
    'workflow',
    body,
  );
}

interface AgentCall {
  readonly prompt: string;
  readonly opts: { phase?: string; label?: string; effort?: string; schema?: unknown };
}

interface AdapterRun {
  readonly result: unknown;
  readonly calls: readonly AgentCall[];
  readonly phases: readonly string[];
  readonly logs: readonly string[];
}

type Responder = (phase: string, call: AgentCall, index: number) => unknown;

async function runAdapter(args: unknown, respond: Responder): Promise<AdapterRun> {
  const calls: AgentCall[] = [];
  const phases: string[] = [];
  const logs: string[] = [];
  const agent = async (prompt: string, opts: AgentCall['opts'] = {}): Promise<unknown> => {
    const call = { prompt, opts };
    calls.push(call);
    return respond(opts.phase ?? '', call, calls.length - 1);
  };
  const unusedStage = async (): Promise<never> => {
    throw new Error('the BOOTSTRAP_RED_ONLY adapter must not use pipeline/parallel/workflow');
  };
  const budget = { total: 0, spent: () => 0, remaining: () => 0 };
  const result = await compileAdapter()(
    agent,
    unusedStage,
    unusedStage,
    (title: string) => {
      phases.push(title);
    },
    (message: string) => {
      logs.push(message);
    },
    args,
    budget,
    unusedStage,
  );
  return { result, calls, phases, logs };
}

const ARGS = {
  mode: 'BOOTSTRAP_RED_ONLY',
  runStamp: '2026-09-30T12-00-00Z',
  baseSha: 'e617c7b7bb4613b95c6934004201eb14bec89ba0',
  evidenceDir: 'docs/architecture/audits/evidence/ppe-v1/2026-09-30T12-00-00Z',
  target: { dockerfile: 'Dockerfile', stages: ['production-base', 'builder'] },
};

const STAGE_ARTIFACTS = {
  DISCOVER: validDiscovery,
  BUILD_GRAPH: validGraph,
  DECISION_GATE: validGate,
  RED_SYNTHESIS: validRedPlan,
} as const;

const HAPPY_RUN_SUMMARY = {
  ok: true,
  exitCode: 0,
  runId: ARGS.runStamp,
  mode: 'BOOTSTRAP_RED_ONLY',
  phase: 'RED_SYNTHESIS',
  stoppedAtPhase: 'RED_SYNTHESIS',
  stoppedByMode: { atPhase: 'RED_SYNTHESIS', reason: 'BOOTSTRAP_RED_ONLY' },
  storedArtifacts: ['discovery', 'dependency-graph', 'decision-gate', 'red-plan'],
};

const PROBE_RESULTS = [
  {
    stage: 'production-base',
    exitCode: 1,
    classification: 'FAIL',
    reasonCode: 'LIFECYCLE_SCRIPT_MODULE_NOT_FOUND',
    fidelity: 'host-npm',
  },
  {
    stage: 'builder',
    exitCode: 1,
    classification: 'FAIL',
    reasonCode: 'LIFECYCLE_SCRIPT_MODULE_NOT_FOUND',
    fidelity: 'host-npm',
  },
];

/** A schema-shaped, validation.ok stage result (with runSummary + probeResults for RED_SYNTHESIS). */
function okStage(phase: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const key = phase as keyof typeof STAGE_ARTIFACTS;
  const artifact = STAGE_ARTIFACTS[key]();
  const base: Record<string, unknown> = {
    artifact,
    validation: { ok: true, errors: [] },
    artifactPath: `${ARGS.evidenceDir}/${KINDS_BY_PHASE[key]}.json`,
  };
  if (phase === 'RED_SYNTHESIS') {
    base.runSummary = HAPPY_RUN_SUMMARY;
    base.probeResults = PROBE_RESULTS;
  }
  return { ...base, ...overrides };
}

const happyResponder: Responder = (phase) => okStage(phase);

function asRecord(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------

describe('(e) file shape (T5)', () => {
  it('starts with the /* global */ directive and `export const meta` is the first statement', () => {
    expect(SOURCE.split('\n')[0]).toBe(GLOBAL_DIRECTIVE);
    const sourceFile = parse();
    const { statement } = metaStatement(sourceFile);
    expect(sourceFile.statements[0]).toBe(statement);
    expect(SOURCE.slice(SOURCE.indexOf('\n') + 1)).toMatch(/^export const meta = \{/);
  });

  it('is plain JavaScript: no import/require, no fs, no Date.now/Math.random/new Date()', () => {
    const sourceFile = parse();
    const forbidden: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node))
        forbidden.push(node.getText(sourceFile));
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(sourceFile);
        if (text === 'require' || text === 'import' || text === 'Date.now' || text === 'Math.random')
          forbidden.push(text);
      }
      if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === 'Date')
        forbidden.push('new Date');
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(forbidden).toEqual([]);
    expect(SOURCE).not.toMatch(/\bfs\./);
    expect(SOURCE).not.toMatch(/\bimport\(/);
  });
});

describe('(b) meta literal (T4)', () => {
  it('is a pure object literal that evaluates to name ppe-v1 with the four BOOTSTRAP phases', () => {
    const sourceFile = parse();
    const { initializer } = metaStatement(sourceFile);
    expect(isPureLiteral(initializer)).toBe(true);
    const meta = new Function(`return (${initializer.getText(sourceFile)})`)() as {
      name: string;
      description: string;
      whenToUse: string;
      phases: { title: string }[];
    };
    expect(meta.name).toBe('ppe-v1');
    expect(typeof meta.description).toBe('string');
    expect(meta.description.length).toBeGreaterThan(0);
    expect(typeof meta.whenToUse).toBe('string');
    expect(meta.phases.map((p) => p.title)).toEqual([...PHASES]);
    expect(Object.keys(meta).sort()).toEqual(['description', 'name', 'phases', 'whenToUse']);
    // D2: no WRITER/VERIFY/ASSEMBLE phase exists in this adapter
    expect(meta.phases.some((p) => /WRITER|VERIFY|ASSEMBLE/.test(p.title))).toBe(false);
  });
});

describe('(a) generated schema block drift (T13)', () => {
  it('the block between the markers byte-equals a fresh regeneration through the generator', async () => {
    const regenerated = await renderGeneratedSchemaBlock();
    expect(extractGeneratedBlock(SOURCE)).toBe(regenerated);
    expect(applyGeneratedBlock(SOURCE, regenerated)).toBe(SOURCE);
    expect(regenerated.startsWith(`const ${ADAPTER_SCHEMA_CONST_NAME} = {`)).toBe(true);
    expect(regenerated.endsWith('};\n')).toBe(true);
  });

  it('the markers appear exactly once, in order, and applyGeneratedBlock fails when they are missing', () => {
    expect(SOURCE.split(`${GENERATED_BLOCK_BEGIN_MARKER}\n`)).toHaveLength(2);
    expect(SOURCE.split(`${GENERATED_BLOCK_END_MARKER}\n`)).toHaveLength(2);
    expect(SOURCE.indexOf(GENERATED_BLOCK_BEGIN_MARKER)).toBeLessThan(
      SOURCE.indexOf(GENERATED_BLOCK_END_MARKER),
    );
    expect(() => applyGeneratedBlock('const x = 1;\n', 'const y = 2;\n')).toThrow(/BEGIN marker/);
    expect(() => applyGeneratedBlock(`${GENERATED_BLOCK_BEGIN_MARKER}\nconst a = 1;\n`, 'x\n')).toThrow(
      /END marker/,
    );
    expect(() => applyGeneratedBlock(SOURCE, 'no trailing newline')).toThrow(/newline/);
    const swapped = applyGeneratedBlock(SOURCE, 'const PPE_SCHEMAS = {};\n');
    expect(extractGeneratedBlock(swapped)).toBe('const PPE_SCHEMAS = {};\n');
    expect(swapped.slice(0, swapped.indexOf(GENERATED_BLOCK_BEGIN_MARKER))).toBe(
      SOURCE.slice(0, SOURCE.indexOf(GENERATED_BLOCK_BEGIN_MARKER)),
    );
  });
});

describe('(d) every schema in the block stays inside the trusted draft-07 subset', () => {
  const block = extractGeneratedBlock(SOURCE);
  const schemas = new Function(`${block}\nreturn ${ADAPTER_SCHEMA_CONST_NAME};`)() as Record<string, unknown>;

  it('holds all eight kinds, deep-equal to PPE_ARTIFACT_SCHEMAS, with sorted keys', () => {
    expect(Object.keys(schemas)).toEqual([...PATTERN_PROOF_ARTIFACT_KINDS].sort());
    for (const kind of PATTERN_PROOF_ARTIFACT_KINDS)
      expect(schemas[kind]).toEqual(PPE_ARTIFACT_SCHEMAS[kind]);
  });

  for (const kind of PATTERN_PROOF_ARTIFACT_KINDS) {
    it(`${kind}: only PPE_SCHEMA_KEYWORDS, no contradictions`, () => {
      const keywords = listSchemaKeywords(schemas[kind]);
      const outside = keywords.filter((k) => !(PPE_SCHEMA_KEYWORDS as readonly string[]).includes(k));
      expect(outside).toEqual([]);
      expect(schemaContradictions(schemas[kind])).toEqual([]);
    });
  }
});

describe('(c) control flow with stubbed Workflow globals (T4)', () => {
  it('(i) mode FULL_PATTERN_PROOF: returns { refused } citing section 7 and never calls agent()', async () => {
    const run = await runAdapter(
      { ...ARGS, mode: 'FULL_PATTERN_PROOF', ownerGo: 'FULL_PATTERN_PROOF' },
      happyResponder,
    );
    const result = asRecord(run.result);
    expect(typeof result.refused).toBe('string');
    expect(result.refused).toContain('FULL_PATTERN_PROOF is a separate unit');
    expect(result.refused).toContain('BOOTSTRAP design section 7');
    expect(result.mode).toBe('FULL_PATTERN_PROOF');
    expect(run.calls).toHaveLength(0);
    expect(run.phases).toHaveLength(0);
  });

  it('refuses a missing mode, missing args and missing evidenceDir/runStamp/baseSha before any agent()', async () => {
    for (const args of [
      undefined,
      null,
      {},
      { ...ARGS, mode: undefined },
      { ...ARGS, evidenceDir: '' },
      { ...ARGS, runStamp: undefined },
      { ...ARGS, baseSha: undefined },
    ]) {
      const run = await runAdapter(args, happyResponder);
      expect(typeof asRecord(run.result).refused, JSON.stringify(args)).toBe('string');
      expect(run.calls).toHaveLength(0);
    }
  });

  it('(ii) happy path: four agents in phase order, each effort high with its stage schema; returns stoppedAt RED_SYNTHESIS', async () => {
    const run = await runAdapter(ARGS, happyResponder);
    expect(run.calls).toHaveLength(4);
    expect(run.calls.map((c) => c.opts.phase)).toEqual([...PHASES]);
    expect(run.phases).toEqual([...PHASES]);
    for (const call of run.calls) {
      expect(call.opts.effort).toBe('high');
      expect(typeof call.opts.label).toBe('string');
      expect(call.opts.schema).toBeDefined();
    }
    const result = asRecord(run.result);
    expect(result).toMatchObject({
      mode: 'BOOTSTRAP_RED_ONLY',
      runStamp: ARGS.runStamp,
      baseSha: ARGS.baseSha,
      evidenceDir: ARGS.evidenceDir,
      stoppedAt: 'RED_SYNTHESIS',
      terminal: false,
      runSummary: HAPPY_RUN_SUMMARY,
      probeResults: PROBE_RESULTS,
    });
    expect(result.failedClosed).toBeUndefined();
    const paths = asRecord(result.artifactPaths);
    expect(paths.discovery).toBe(`${ARGS.evidenceDir}/discovery.json`);
    expect(paths.redPlan).toBe(`${ARGS.evidenceDir}/red-plan.json`);
    expect(paths.probes).toEqual([
      `${ARGS.evidenceDir}/probe-production-base.json`,
      `${ARGS.evidenceDir}/probe-builder.json`,
    ]);
    expect(run.logs.some((l) => l.includes('WRITER never entered'))).toBe(true);
  });

  it('the stage schemas handed to agent() are subset-clean and accept the stub results (as Ajv would)', async () => {
    const run = await runAdapter(ARGS, happyResponder);
    run.calls.forEach((call, index) => {
      const schema = call.opts.schema as SubsetSchema;
      const outside = listSchemaKeywords(schema).filter(
        (k) => !(PPE_SCHEMA_KEYWORDS as readonly string[]).includes(k),
      );
      expect(outside, PHASES[index]).toEqual([]);
      expect(schemaContradictions(schema), PHASES[index]).toEqual([]);
      const stubResult = okStage(PHASES[index]);
      const check = validateAgainstSubsetSchema(schema, stubResult);
      expect(check.errors, PHASES[index]).toEqual([]);
      // the artifact slot IS the generated schema of that kind
      expect(schema.properties?.artifact).toEqual(PPE_ARTIFACT_SCHEMAS[KINDS_BY_PHASE[PHASES[index]]]);
      expect(schema.required).toEqual(expect.arrayContaining(['artifact', 'validation', 'artifactPath']));
    });
    const redSchema = run.calls[3].opts.schema as SubsetSchema;
    expect(redSchema.required).toEqual(expect.arrayContaining(['runSummary', 'probeResults']));
    expect(redSchema.properties?.runSummary?.required).toEqual(['exitCode', 'phase', 'storedArtifacts']);
  });

  it('prompts: each stage validates with ppe-cli, later stages read only the artifact files, RED_SYNTHESIS runs `ppe-cli run` and red-probe per stage', async () => {
    const run = await runAdapter(ARGS, happyResponder);
    const [discover, graph, gate, red] = run.calls.map((c) => c.prompt);
    const validate = 'npx tsx packages/mps-pattern-proof/scripts/ppe-cli.ts validate --kind';
    expect(discover).toContain(`${validate} discovery --file ${ARGS.evidenceDir}/discovery.json`);
    expect(discover).toContain(`${ARGS.evidenceDir}/runtime-ledger.json`);
    expect(discover).toContain('docker-compose.staging.yml');
    expect(discover).toContain('Dockerfile.gcp');
    expect(discover).toContain('.github/workflows/deploy-*.yml');
    expect(graph).toContain(`Read ONLY ${ARGS.evidenceDir}/discovery.json`);
    expect(graph).toContain(`${validate} dependency-graph`);
    expect(gate).toContain(`${validate} decision-gate`);
    expect(gate).toContain('MECHANICAL');
    expect(red).toContain(`${validate} red-plan`);
    expect(red).toContain(
      `npx tsx packages/mps-pattern-proof/scripts/ppe-cli.ts run --dir ${ARGS.evidenceDir} --mode BOOTSTRAP_RED_ONLY --repo-root . --run-id ${ARGS.runStamp} --base-sha ${ARGS.baseSha} --json`,
    );
    for (const stage of ARGS.target.stages) {
      expect(red).toContain(
        `npx tsx packages/mps-pattern-proof/scripts/red-probe.ts --dockerfile Dockerfile --stage ${stage} --executor auto --json --out ${ARGS.evidenceDir}/probe-${stage}.json`,
      );
    }
    expect(red).toContain('AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH');
    // solution neutrality: no prompt prescribes a fix; RED_SYNTHESIS names `--ignore-scripts` only as what NOT to assert
    expect(red).toContain('never "add --ignore-scripts"');
    for (const prompt of [discover, graph, gate]) expect(prompt).not.toMatch(/--ignore-scripts/);
    for (const prompt of run.calls.map((c) => c.prompt)) expect(prompt).toContain('Do not commit');
  });

  it('(iii) validation.ok false at BUILD_GRAPH: failedClosed at BUILD_GRAPH after exactly 2 agents', async () => {
    const run = await runAdapter(ARGS, (phase) =>
      phase === 'BUILD_GRAPH'
        ? okStage(phase, {
            validation: { ok: false, errors: ['PPE_GRAPH_DANGLING_EDGE: edge to unknown node'] },
          })
        : okStage(phase),
    );
    expect(run.calls).toHaveLength(2);
    expect(asRecord(run.result)).toMatchObject({
      failedClosed: true,
      atPhase: 'BUILD_GRAPH',
      mode: 'BOOTSTRAP_RED_ONLY',
      runStamp: ARGS.runStamp,
    });
    expect(asRecord(run.result).reason).toContain('PPE_GRAPH_DANGLING_EDGE');
    expect(asRecord(run.result).stoppedAt).toBeUndefined();
  });

  it('agent() returning null (skipped / terminal API error) fails closed at that phase', async () => {
    const run = await runAdapter(ARGS, (phase) => (phase === 'DISCOVER' ? null : okStage(phase)));
    expect(run.calls).toHaveLength(1);
    expect(asRecord(run.result)).toMatchObject({ failedClosed: true, atPhase: 'DISCOVER' });
    expect(asRecord(run.result).reason).toContain('null');
  });

  it('(iv) a non-MECHANICAL gate item: stoppedAt DECISION_GATE with the classification + blockingReason after exactly 3 agents', async () => {
    const run = await runAdapter(ARGS, (phase) => {
      if (phase !== 'DECISION_GATE') return okStage(phase);
      const gate = validGate();
      return okStage(phase, {
        artifact: {
          items: [
            ...gate.items,
            {
              item: 'Should C-anmälan show the whole verdict or a simplified projection?',
              classification: 'HUMAN_DECISION_REQUIRED',
              blockingReason: 'owner-level semantic decision',
            },
          ],
        },
      });
    });
    expect(run.calls).toHaveLength(3);
    expect(run.calls.map((c) => c.opts.phase)).toEqual(['DISCOVER', 'BUILD_GRAPH', 'DECISION_GATE']);
    const result = asRecord(run.result);
    expect(result).toMatchObject({
      stoppedAt: 'DECISION_GATE',
      terminalCandidate: 'HUMAN_DECISION_REQUIRED',
      blockingReason: 'owner-level semantic decision',
    });
    expect(result.failedClosed).toBeUndefined();
    expect(result.runSummary).toBeUndefined();
    expect(String(result.authoritativeVerdict)).toContain('ppe-cli.ts run');
  });

  it('(v) runSummary.exitCode 1 (inadmissible) or a wrong stoppedAtPhase: failedClosed at RED_SYNTHESIS', async () => {
    const bad = [
      { ...HAPPY_RUN_SUMMARY, ok: false, exitCode: 1, stoppedAtPhase: undefined, stoppedByMode: undefined },
      { ...HAPPY_RUN_SUMMARY, exitCode: 2 },
      { ...HAPPY_RUN_SUMMARY, stoppedAtPhase: 'WRITER', phase: 'WRITER' },
      { ...HAPPY_RUN_SUMMARY, stoppedAtPhase: undefined },
    ];
    for (const runSummary of bad) {
      const run = await runAdapter(ARGS, (phase) =>
        phase === 'RED_SYNTHESIS' ? okStage(phase, { runSummary }) : okStage(phase),
      );
      expect(run.calls).toHaveLength(4);
      const result = asRecord(run.result);
      expect(result, JSON.stringify(runSummary)).toMatchObject({
        failedClosed: true,
        atPhase: 'RED_SYNTHESIS',
      });
      expect(result.runSummary).toEqual(runSummary);
      expect(result.stoppedAt).toBeUndefined();
    }
    const noSummary = await runAdapter(ARGS, (phase) =>
      phase === 'RED_SYNTHESIS' ? okStage(phase, { runSummary: null }) : okStage(phase),
    );
    expect(asRecord(noSummary.result)).toMatchObject({ failedClosed: true, atPhase: 'RED_SYNTHESIS' });
  });

  it('runSummary.exitCode 3 (a terminal state decided by ppe-cli run) is returned as a terminal stop, not a failure', async () => {
    const terminalSummary = {
      ok: true,
      exitCode: 3,
      runId: ARGS.runStamp,
      mode: 'BOOTSTRAP_RED_ONLY',
      phase: 'RED_SYNTHESIS',
      terminalState: 'MISSING_AUTHORITY',
      storedArtifacts: ['discovery', 'dependency-graph', 'decision-gate'],
    };
    const run = await runAdapter(ARGS, (phase) =>
      phase === 'RED_SYNTHESIS' ? okStage(phase, { runSummary: terminalSummary }) : okStage(phase),
    );
    expect(run.calls).toHaveLength(4);
    expect(asRecord(run.result)).toMatchObject({
      stoppedAt: 'RED_SYNTHESIS',
      terminal: true,
      terminalState: 'MISSING_AUTHORITY',
      runSummary: terminalSummary,
    });
    expect(asRecord(run.result).failedClosed).toBeUndefined();
  });

  it('defaults target to Dockerfile + [production-base, builder] when args.target is absent', async () => {
    const { target: _target, ...withoutTarget } = ARGS;
    const run = await runAdapter(withoutTarget, happyResponder);
    expect(run.calls).toHaveLength(4);
    expect(run.calls[3].prompt).toContain('--dockerfile Dockerfile --stage production-base');
    expect(run.calls[3].prompt).toContain('--dockerfile Dockerfile --stage builder');
  });

  it('refuses (before any agent) when a Workflow runtime API is missing', async () => {
    const compiled = compileAdapter();
    const calls: unknown[] = [];
    const result = await compiled(
      async (...a: unknown[]) => {
        calls.push(a);
        return null;
      },
      undefined,
      undefined,
      () => undefined,
      () => undefined,
      ARGS,
      { total: 0, spent: () => 0, remaining: () => 0 },
      undefined,
    );
    expect(asRecord(result).refused).toContain('"pipeline"');
    expect(calls).toHaveLength(0);
  });
});

describe('adapter location (D14)', () => {
  it('lives inside the package at workflow/ppe-v1.js and no .claude/workflows copy exists', () => {
    expect(path.relative(process.cwd(), ADAPTER_FILE)).toBe(
      path.join('packages', 'mps-pattern-proof', 'workflow', 'ppe-v1.js'),
    );
    expect(fs.existsSync(path.join(process.cwd(), '.claude', 'workflows', 'ppe-v1.js'))).toBe(false);
  });
});
