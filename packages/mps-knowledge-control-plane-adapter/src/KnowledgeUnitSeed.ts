import type { MultiAgentUnitState } from '@miljobeslut/mps-control-plane';

// Reused as a black box, read-only: scripts/devgov/** is forbidden territory
// for this unit (see governance/devgov/units/knowledge-control-plane-integration-v1.json
// forbidden_paths). unitDefinitionHash/proofContractHash are already computed
// generically by DEV-GOV for every unit definition, Control-Plane's and
// Knowledge's alike -- this file does not reimplement that hashing, it calls
// the same exported functions the CI attestation path calls.
// eslint-disable-next-line import/extensions -- devgov.mjs is a real ESM file, not a package export
import { proofContractHash, unitDefinitionHash } from '../../../scripts/devgov/devgov.mjs';
import type { KnowledgeUnitDefinitionLike } from './types';

export class KnowledgeUnitSeedError extends Error {}

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export interface SeedKnowledgeUnitOptions {
  /**
   * Overrides the unit id the canonical state is keyed by. Defaults to
   * `unitDefinition.unit`. Present so a caller can run several instances of
   * the same unit definition (e.g. fixtures/tests) without collision.
   */
  readonly unitId?: string;
  readonly scope?: readonly string[];
  readonly now?: () => Date;
}

/**
 * Pure translation: a DEV-GOV-V1 Knowledge unit definition (already the sole
 * authority for what work this unit covers and which paths it may touch) into
 * the initial `MultiAgentUnitState` the Control Plane's
 * `FileDurableControlPlaneStore.initializeUnit` expects. Computes nothing the
 * unit definition doesn't already determine: `unitDefinitionHash` and
 * `proofContractHash` are exact, deterministic functions of the definition
 * document; `scope` defaults to its own `allowed_paths`. Never invents a
 * candidate SHA, state beyond `PLANNED`, or a revision beyond `0` -- those
 * only exist once real work and real controller activation have happened.
 */
export function seedKnowledgeUnitState(
  unitDefinition: KnowledgeUnitDefinitionLike,
  options: SeedKnowledgeUnitOptions = {},
): MultiAgentUnitState {
  if (!unitDefinition || typeof unitDefinition !== 'object') {
    throw new KnowledgeUnitSeedError('unit definition must be an object');
  }
  const unitId = options.unitId ?? unitDefinition.unit;
  if (typeof unitId !== 'string' || unitId.length === 0) {
    throw new KnowledgeUnitSeedError('unit definition is missing a non-empty "unit"');
  }
  if (typeof unitDefinition.base_sha !== 'string' || !SHA_PATTERN.test(unitDefinition.base_sha)) {
    throw new KnowledgeUnitSeedError(`unit definition "base_sha" must be a 40-hex-char commit SHA, got: ${String(unitDefinition.base_sha)}`);
  }
  if (typeof unitDefinition.branch !== 'string' || unitDefinition.branch.length === 0) {
    throw new KnowledgeUnitSeedError('unit definition is missing a non-empty "branch"');
  }
  const scope = options.scope ?? unitDefinition.allowed_paths;
  if (!Array.isArray(scope) || scope.length === 0) {
    throw new KnowledgeUnitSeedError('unit definition is missing a non-empty "allowed_paths" scope');
  }

  const now = options.now ?? (() => new Date());

  return {
    unitId,
    unitDefinitionHash: unitDefinitionHash(unitDefinition),
    baseSha: unitDefinition.base_sha,
    branch: unitDefinition.branch,
    scope: [...scope],
    proofContractHash: proofContractHash(unitDefinition),
    controllerContractVersion: 'multi-agent-control-plane-v1',
    state: 'PLANNED',
    revision: 0,
    updatedAt: now().toISOString(),
  };
}
