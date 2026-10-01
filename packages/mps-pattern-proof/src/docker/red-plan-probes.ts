/**
 * PATTERN-PROOF-ENGINE-01 V1 -- the two frozen RED probes, VERBATIM from
 * docs/architecture/PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY-DESIGN-FROZEN.md section 5.4
 * (`RedPlanArtifact`), keyed by the Dockerfile stage each one targets. Do not hand-edit the text.
 */
import type { RedProbe } from '../artifacts';
import { PatternProofError } from '../errors';

export const FROZEN_RED_PROBE_STAGES = ['production-base', 'builder'] as const;

export type FrozenRedProbeStage = (typeof FROZEN_RED_PROBE_STAGES)[number];

function deepFreezeProbe(probe: RedProbe): RedProbe {
  Object.freeze(probe.authorityEvidence);
  return Object.freeze(probe);
}

export const FROZEN_RED_PROBES: Readonly<Record<FrozenRedProbeStage, RedProbe>> = Object.freeze({
  'production-base': deepFreezeProbe({
    id: 'red-production-base-npm-ci-postinstall',
    assertedBehavior:
      "The root Dockerfile's production-base stage must be able to execute its declared npm dependency-install step without failing because package.json lifecycle-script dependencies are absent from the filesystem state established by that stage before the install step.",
    authorityEvidence: {
      kind: 'file_line',
      ref: 'docker-compose.staging.yml:6-8',
      note: 'direct declared staging web-build contract: root Dockerfile, target web',
    },
    command:
      'derive the production-base stage filesystem/input state and npm-install command from the Dockerfile under test, execute an equivalent isolated stage-prefix probe, and assert that the dependency-install step does not fail with a missing lifecycle-script dependency',
  }),
  builder: deepFreezeProbe({
    id: 'red-builder-npm-ci-postinstall',
    assertedBehavior:
      "The root Dockerfile's builder stage must be able to execute its declared npm dependency-install step without failing because package.json lifecycle-script dependencies are absent from the filesystem state established by that stage before the install step.",
    authorityEvidence: {
      kind: 'file_line',
      ref: 'docker-compose.staging.yml:6-8',
      note: 'the declared staging web build necessarily traverses the builder stage',
    },
    command:
      'derive the builder-stage filesystem/input state and npm-install command from the Dockerfile under test, execute an equivalent isolated stage-prefix probe, and assert that the dependency-install step does not fail with a missing lifecycle-script dependency',
  }),
});

export function isFrozenRedProbeStage(stage: string): stage is FrozenRedProbeStage {
  return (FROZEN_RED_PROBE_STAGES as readonly string[]).includes(stage);
}

/** The frozen RED probe for a stage; throws PPE_STAGE_NOT_FOUND for a stage without a frozen probe. */
export function redProbeForStage(stage: string): RedProbe {
  if (!isFrozenRedProbeStage(stage)) {
    throw new PatternProofError('PPE_STAGE_NOT_FOUND', `no frozen RED probe for stage "${stage}"`, {
      details: { stages: [...FROZEN_RED_PROBE_STAGES] },
    });
  }
  return FROZEN_RED_PROBES[stage];
}
