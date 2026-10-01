import { describe, expect, it } from 'vitest';

import { proofContractHash, unitDefinitionHash } from '../../../scripts/devgov/devgov.mjs';
import { KnowledgeUnitSeedError, seedKnowledgeUnitState } from '../src';

const BASE_SHA = 'a'.repeat(40);

function unitDefinition(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'dev-gov-v1-unit-definition',
    unit: 'KNOWLEDGE-TEST-UNIT-1',
    role: 'producer',
    mode: 'writer',
    branch: 'codex/knowledge-test-unit-1',
    base_sha: BASE_SHA,
    ancestry_policy: 'descendant_of_base',
    allowed_paths: ['packages/mps-knowledge-corpus/**'],
    forbidden_paths: ['.github/**'],
    ...overrides,
  };
}

describe('seedKnowledgeUnitState', () => {
  it('is deterministic: identical input produces byte-identical output', () => {
    const now = () => new Date('2026-09-08T00:00:00.000Z');
    const first = seedKnowledgeUnitState(unitDefinition(), { now });
    const second = seedKnowledgeUnitState(unitDefinition(), { now });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('computes unitDefinitionHash and proofContractHash the same way DEV-GOV itself does', () => {
    const def = unitDefinition();
    const seeded = seedKnowledgeUnitState(def, { now: () => new Date('2026-09-08T00:00:00.000Z') });
    expect(seeded.unitDefinitionHash).toBe(unitDefinitionHash(def));
    expect(seeded.proofContractHash).toBe(proofContractHash(def));
  });

  it('produces a different unitDefinitionHash for a different unit definition', () => {
    const a = seedKnowledgeUnitState(unitDefinition());
    const b = seedKnowledgeUnitState(unitDefinition({ unit: 'KNOWLEDGE-TEST-UNIT-2' }));
    expect(a.unitDefinitionHash).not.toBe(b.unitDefinitionHash);
  });

  it('starts at PLANNED, revision 0, with no candidate SHA yet', () => {
    const seeded = seedKnowledgeUnitState(unitDefinition());
    expect(seeded.state).toBe('PLANNED');
    expect(seeded.revision).toBe(0);
    expect(seeded.candidateSha).toBeUndefined();
    expect(seeded.controllerContractVersion).toBe('multi-agent-control-plane-v1');
  });

  it('derives scope from allowed_paths by default', () => {
    const seeded = seedKnowledgeUnitState(unitDefinition({ allowed_paths: ['a/**', 'b/**'] }));
    expect(seeded.scope).toEqual(['a/**', 'b/**']);
  });

  it('fails closed on a missing/invalid base_sha rather than guessing', () => {
    expect(() => seedKnowledgeUnitState(unitDefinition({ base_sha: 'not-a-sha' }))).toThrow(
      KnowledgeUnitSeedError,
    );
    expect(() => seedKnowledgeUnitState(unitDefinition({ base_sha: undefined }))).toThrow(
      KnowledgeUnitSeedError,
    );
  });

  it('fails closed on a missing unit id', () => {
    expect(() => seedKnowledgeUnitState(unitDefinition({ unit: '' }))).toThrow(KnowledgeUnitSeedError);
  });

  it('fails closed on an empty allowed_paths scope', () => {
    expect(() => seedKnowledgeUnitState(unitDefinition({ allowed_paths: [] }))).toThrow(
      KnowledgeUnitSeedError,
    );
  });
});
