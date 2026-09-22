import { describe, expect, it } from 'vitest';

import {
  buildStaticAuthoringChecks,
  collectRedHarnessWarnings,
  collectRepoLikePaths,
  findUnusedAllowedPaths,
} from '../tooling/devgov-authoring-preflight.mjs';

const BASE = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);

function definition(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'dev-gov-v1-unit-definition',
    unit: 'AUTHORING-PREFLIGHT-TEST',
    role: 'producer',
    mode: 'writer',
    branch: 'tooling/test',
    base_sha: BASE,
    ancestry_policy: 'descendant_of_base',
    allowed_paths: ['src/**', 'tests/unit/new-proof.test.ts'],
    forbidden_paths: [],
    required_red: [],
    required_green: [],
    ...overrides,
  };
}

describe('DEV-GOV authoring preflight helpers', () => {
  it('extracts repo paths from ordinary args and inline proof programs', () => {
    expect(
      collectRepoLikePaths([
        'tests/unit/new-proof.test.ts',
        "const p = 'packages/mps-lu/src/index.ts';",
      ]),
    ).toEqual(['packages/mps-lu/src/index.ts', 'tests/unit/new-proof.test.ts']);
  });

  it('warns when a base RED depends on a candidate-only proof file', () => {
    const value = definition({
      required_red: [
        {
          id: 'red',
          command: 'node',
          args: ['--input-type=module', '-e', "readFileSync('tests/unit/new-proof.test.ts')"],
          expected_classification: 'FAIL',
          required_head: 'base_sha',
          blocked_exit_codes: [2],
        },
      ],
    });
    const existsAt = (ref: string, path: string) =>
      ref === CANDIDATE && path === 'tests/unit/new-proof.test.ts';

    const report = buildStaticAuthoringChecks(
      value as never,
      CANDIDATE,
      ['src/changed.ts', 'tests/unit/new-proof.test.ts'],
      existsAt,
    );

    expect(report.candidateOnlyRedReferences).toEqual([
      { proof_id: 'red', path: 'tests/unit/new-proof.test.ts' },
    ]);
    expect(report.warnings.join('\n')).toContain('candidate-only path');
  });

  it('reports allowed paths that do not match the actual candidate diff', () => {
    expect(
      findUnusedAllowedPaths(definition() as never, [
        'src/changed.ts',
        'tests/unit/new-proof.test.ts',
      ]),
    ).toEqual([]);
    expect(
      findUnusedAllowedPaths(
        definition({ allowed_paths: ['src/**', 'docs/never-touched.md'] }) as never,
        ['src/changed.ts'],
      ),
    ).toEqual(['docs/never-touched.md']);
  });

  it('flags RED harnesses without a dedicated blocked-environment exit', () => {
    expect(
      collectRedHarnessWarnings(
        definition({
          required_red: [
            {
              id: 'red',
              command: 'node',
              args: ['-e', 'process.exit(1)'],
              expected_classification: 'FAIL',
              required_head: 'base_sha',
            },
          ],
        }) as never,
      ),
    ).toEqual([
      'red: RED declares no blocked_exit_codes; verify that a harness/environment crash cannot satisfy FAIL',
    ]);
  });
});
