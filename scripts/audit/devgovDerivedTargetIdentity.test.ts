import { describe, expect, it } from 'vitest';

import {
  evaluateShaVerification,
  RESULT,
  unitDefinitionHash,
  validateUnitDefinition,
} from '../devgov/devgov.mjs';

const candidateSha = 'b'.repeat(40);

const unitDefinition = {
  schema_version: 'dev-gov-v1-unit-definition',
  unit: 'DEV-GOV-V7-DERIVED-TARGET-IDENTITY',
  role: 'producer',
  mode: 'writer',
  branch: 'codex/dev-gov-v7-derived-target-identity',
  base_sha: 'a'.repeat(40),
  ancestry_policy: 'exact_parent',
  allowed_paths: ['scripts/devgov/**'],
  forbidden_paths: ['.github/workflows/deploy-*.yml'],
};

describe('DEV-GOV-V7 derived candidate identity', () => {
  it('keeps candidate identity out of the committed unit definition', () => {
    expect(unitDefinition).not.toHaveProperty('target_sha');
    expect(unitDefinition).not.toHaveProperty('worktree');
    expect(validateUnitDefinition(unitDefinition)).toEqual([]);
    expect(unitDefinitionHash(unitDefinition)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies the candidate SHA supplied by trusted execution against repository HEAD', () => {
    const result = evaluateShaVerification(
      unitDefinition,
      {
        head_sha: candidateSha,
        remote_sha: candidateSha,
        remote_status: 'REMOTE_MATCH',
        dirty: false,
      },
      { candidateSha },
    );

    expect(result).toEqual({ result: RESULT.PASS, errors: [] });
  });

  it('does not implicitly reinterpret the historical V6 manifest contract', () => {
    const legacy = {
      ...unitDefinition,
      schema_version: 'dev-gov-v0',
      target_sha: candidateSha,
      worktree: process.cwd(),
    };

    const errors = validateUnitDefinition(legacy);

    expect(errors).toContain('schema_version must be dev-gov-v1-unit-definition');
    expect(errors).toContain('target_sha is forbidden in a unit definition');
    expect(errors).toContain('worktree is forbidden in a unit definition');
  });
});
