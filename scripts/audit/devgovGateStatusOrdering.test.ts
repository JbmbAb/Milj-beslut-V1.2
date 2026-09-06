import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Behavioural proof of mandate 16: the published commit status can never
 * precede or contradict the authoritative signed gate verdict.
 *
 * Instead of asserting on the text of the workflow, this executes the real
 * `run:` script of the "Publish exact candidate gate result" step under bash
 * with `gh` replaced by a recording stub, and observes which state the step
 * actually posts and whether it fails the job.
 */

const gatePath = path.resolve(process.cwd(), '.github/workflows/devgov-v0-gate.yml');
const PUBLISH_STEP_NAME = 'Publish exact candidate gate result';
const STATUS_CONTEXT = 'DEV-GOV-V0 / trusted-execution';
const CANDIDATE_SHA = 'a'.repeat(40);

const bashAvailable = (() => {
  try {
    const probe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
    return probe.status === 0 && (probe.stdout ?? '').trim() === 'ok';
  } catch {
    return false;
  }
})();

const loadPublishStepRun = (): string => {
  const workflow = parse(readFileSync(gatePath, 'utf8'));
  const steps: Array<Record<string, any>> = workflow.jobs['evidence-gate'].steps;
  const publish = steps.find((step) => step.name === PUBLISH_STEP_NAME);
  if (!publish || typeof publish.run !== 'string') {
    throw new Error(`step "${PUBLISH_STEP_NAME}" with a run script was not found in ${gatePath}`);
  }
  return publish.run;
};

const createGhStub = () => {
  const stubDir = mkdtempSync(path.join(tmpdir(), 'devgov-gh-stub-'));
  const logFile = path.join(stubDir, 'gh-invocations.log');
  const stubPath = path.join(stubDir, 'gh');
  writeFileSync(stubPath, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" >> "$GH_STUB_LOG"\nexit 0\n');
  chmodSync(stubPath, 0o755);
  return { stubDir, logFile };
};

interface StepRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  log: string;
  args: string[];
  invocationCount: number;
  states: string[];
  contexts: string[];
  descriptions: string[];
}

const runPublishStep = (
  gateOutcome: string,
  attestationRunId: string,
  verdictOutcome: string,
): StepRunResult => {
  const run = loadPublishStepRun();
  const { stubDir, logFile } = createGhStub();
  const result = spawnSync('bash', ['-eo', 'pipefail', '-c', run], {
    env: {
      ...process.env,
      PATH: stubDir + path.delimiter + process.env.PATH,
      GH_STUB_LOG: logFile,
      GATE_OUTCOME: gateOutcome,
      ATTESTATION_RUN_ID: attestationRunId,
      VERDICT_OUTCOME: verdictOutcome,
      CANDIDATE_SHA,
      GITHUB_REPOSITORY: 'JbmbAb/Milj-beslut-V1.2',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_RUN_ID: '200',
      GH_TOKEN: 'stub',
    },
    encoding: 'utf8',
  });
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  // The stub writes one argument per line; every `gh` invocation begins with
  // its subcommand (`api`), so counting those lines counts invocations.
  const args = log.split('\n').filter((line) => line.length > 0);
  const valueOf = (prefix: string) =>
    args.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length));
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    log,
    args,
    invocationCount: args.filter((arg) => arg === 'api').length,
    states: valueOf('state='),
    contexts: valueOf('context='),
    descriptions: valueOf('description='),
  };
};

const expectSinglePublication = (result: StepRunResult) => {
  expect(result.invocationCount).toBe(1);
  expect(result.states).toHaveLength(1);
  expect(result.contexts).toEqual([STATUS_CONTEXT]);
  expect(result.args).toContain(`repos/JbmbAb/Milj-beslut-V1.2/statuses/${CANDIDATE_SHA}`);
  expect(result.args).toContain('target_url=https://github.com/JbmbAb/Milj-beslut-V1.2/actions/runs/200');
};

describe('DEV-GOV-V0 gate status ordering (mandate 16: status never precedes or contradicts the verdict)', () => {
  it('finds the publish step as a bash run script in the gate workflow', () => {
    const run = loadPublishStepRun();
    expect(run).toContain('gh api --method POST');
    expect(run).toContain('test "$state" = success');
  });

  it.skipIf(!bashAvailable)(
    'reports failure and fails the job when the gate passed but the verdict upload failed',
    () => {
      const result = runPublishStep('success', '100', 'failure');

      expect(result.status).not.toBe(0);
      expectSinglePublication(result);
      expect(result.log).toContain('state=failure');
      expect(result.log).not.toContain('state=success');
      expect(result.states).toEqual(['failure']);
      expect(result.descriptions[0]).toContain('no authoritative gate verdict was published');
    },
  );

  it.skipIf(!bashAvailable)(
    'reports failure when the verdict step was skipped although the run was orchestrated',
    () => {
      const result = runPublishStep('success', '100', 'skipped');

      expect(result.status).not.toBe(0);
      expectSinglePublication(result);
      expect(result.states).toEqual(['failure']);
      expect(result.log).not.toContain('state=success');
      expect(result.descriptions[0]).toContain('no authoritative gate verdict was published');
    },
  );

  it.skipIf(!bashAvailable)(
    'reports success only after the signed gate verdict was created and uploaded',
    () => {
      const result = runPublishStep('success', '100', 'success');

      expect(result.status).toBe(0);
      expectSinglePublication(result);
      expect(result.states).toEqual(['success']);
      expect(result.log).not.toContain('state=failure');
      expect(result.descriptions).toHaveLength(1);
      expect(result.descriptions[0]).toContain('signed gate verdict');
    },
  );

  it.skipIf(!bashAvailable)(
    'reports failure when the gate failed even though a verdict upload reported success',
    () => {
      const result = runPublishStep('failure', '100', 'success');

      expect(result.status).not.toBe(0);
      expectSinglePublication(result);
      expect(result.states).toEqual(['failure']);
      expect(result.log).not.toContain('state=success');
      expect(result.descriptions[0]).toContain('denied or did not complete');
    },
  );

  it.skipIf(!bashAvailable)('reports failure when the gate failed and the verdict step was skipped', () => {
    const result = runPublishStep('failure', '100', 'skipped');

    expect(result.status).not.toBe(0);
    expectSinglePublication(result);
    expect(result.states).toEqual(['failure']);
    expect(result.log).not.toContain('state=success');
    expect(result.descriptions[0]).toContain('denied or did not complete');
  });

  it.skipIf(!bashAvailable)(
    'legacy single-proof path may post success without a verdict (documented exception)',
    () => {
      const result = runPublishStep('success', '', 'skipped');

      expect(result.status).toBe(0);
      expectSinglePublication(result);
      expect(result.states).toEqual(['success']);
      expect(result.log).not.toContain('state=failure');
      expect(result.descriptions[0]).not.toContain('signed gate verdict');
      expect(result.descriptions[0]).toContain('Trusted RED/GREEN verified for exact candidate SHA');
    },
  );

  it.skipIf(!bashAvailable)('reports failure on the legacy single-proof path when the gate failed', () => {
    const result = runPublishStep('failure', '', 'skipped');

    expect(result.status).not.toBe(0);
    expectSinglePublication(result);
    expect(result.states).toEqual(['failure']);
    expect(result.log).not.toContain('state=success');
  });

  it.skipIf(!bashAvailable)('never posts success for any non-success gate outcome value', () => {
    for (const gateOutcome of ['failure', 'cancelled', 'skipped', '']) {
      for (const verdictOutcome of ['success', 'failure', 'skipped', '']) {
        const result = runPublishStep(gateOutcome, '100', verdictOutcome);
        expect(result.status, `gate=${gateOutcome} verdict=${verdictOutcome}`).not.toBe(0);
        expect(result.states, `gate=${gateOutcome} verdict=${verdictOutcome}`).toEqual(['failure']);
        expect(result.invocationCount, `gate=${gateOutcome} verdict=${verdictOutcome}`).toBe(1);
      }
    }
  });
});
