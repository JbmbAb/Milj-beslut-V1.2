/**
 * Frozen target artifacts, transcribed VERBATIM from
 * docs/architecture/PATTERN-PROOF-ENGINE-01-V1-BOOTSTRAP-RED-ONLY-DESIGN-FROZEN.md sections 5.1-5.4
 * (extracted mechanically from the JSON fences; do not hand-edit). Line citations are the frozen
 * document's own; known drift (package.json:44 -> 46, deploy-gcp.yml:88-89 -> 89-97,
 * deploy-staging.yml:1-6 -> 1-7) is recorded in the unit's audit document, not corrected here.
 */

export const FROZEN_TARGET_DISCOVERY = {
  findings: [
    {
      category: 'build-ordering-defect',
      description:
        "production-base stage runs `npm ci --omit=dev` while only package*.json is present; npm's own postinstall hook requires scripts/postinstall-prisma-generate.mjs, which does not exist in the image yet at that point.",
      evidence: [
        {
          kind: 'file_line',
          ref: 'Dockerfile:32-37',
        },
        {
          kind: 'file_line',
          ref: 'package.json:44',
        },
        {
          kind: 'runtime_result',
          ref: 'local npm-ci reproduction, 2026-09-30, exit 1, MODULE_NOT_FOUND on scripts/postinstall-prisma-generate.mjs',
        },
      ],
    },
    {
      category: 'build-ordering-defect',
      description:
        "builder stage has the structurally identical defect for the identical reason: at Dockerfile:20 (npm ci --legacy-peer-deps) only package*.json + tsconfig.json are present -- prisma/ is not copied until line 22, after npm ci, so it is not part of this stage's pre-npm-ci file set (corrected from an earlier draft that had incorrectly included prisma/). Separately re-executed with the corrected file set: identical MODULE_NOT_FOUND failure.",
      evidence: [
        {
          kind: 'file_line',
          ref: 'Dockerfile:17-20',
        },
        {
          kind: 'runtime_result',
          ref: 'local npm-ci reproduction, 2026-09-30, package.json+package-lock.json+tsconfig.json only: exit 1, MODULE_NOT_FOUND on scripts/postinstall-prisma-generate.mjs',
        },
      ],
    },
    {
      category: 'governed-build-contract',
      description:
        "docker-compose.staging.yml declares { context: '.', dockerfile: 'Dockerfile', target: 'web' } as the staging environment's own build contract; web is FROM production-base, i.e. exactly the broken stage. This declared staging web build is the direct authority, not merely an inference from Dockerfile.gcp's working pattern; production-base is only the internal stage name within it.",
      evidence: [
        {
          kind: 'file_line',
          ref: 'docker-compose.staging.yml:6-8',
        },
        {
          kind: 'file_line',
          ref: 'Dockerfile:58',
        },
      ],
    },
    {
      category: 'existing-working-precedent',
      description:
        'Dockerfile.gcp already solves the same class of problem: both its npm ci invocations pass --ignore-scripts, followed by an explicit npx prisma generate.',
      evidence: [
        {
          kind: 'file_line',
          ref: 'Dockerfile.gcp:26,28,51,53',
        },
      ],
    },
    {
      category: 'authority-for-current-behavior',
      description:
        'no automated CI pipeline builds the plain Dockerfile or invokes docker-compose.staging.yml -- deploy-staging.yml deploys to Vercel via npm run build directly, not via this compose file (per its own header comment); only Dockerfile.gcp is CI-built (deploy-gcp.yml), which does not have this defect. The staging build contract is real and declared, just not currently CI-exercised -- explaining why it has gone unnoticed rather than indicating it is not real or not authoritative.',
      evidence: [
        {
          kind: 'file_line',
          ref: '.github/workflows/deploy-gcp.yml:88-89',
        },
        {
          kind: 'file_line',
          ref: '.github/workflows/deploy-staging.yml:1-6',
        },
        {
          kind: 'runtime_result',
          ref: "repo-wide grep for 'docker build'/'-f Dockerfile', 2026-09-30: only deploy-gcp.yml and build-postgres-image.yml (unrelated Postgres image) match",
        },
      ],
    },
  ],
} as const;

export const FROZEN_TARGET_DEPENDENCY_GRAPH = {
  nodes: [
    {
      id: 'dockerfile:production-base',
      kind: 'docker-stage',
      evidence: [
        {
          kind: 'file_line',
          ref: 'Dockerfile:32',
        },
      ],
    },
    {
      id: 'dockerfile:builder',
      kind: 'docker-stage',
      evidence: [
        {
          kind: 'file_line',
          ref: 'Dockerfile:16',
        },
      ],
    },
    {
      id: 'npm:ci',
      kind: 'npm-lifecycle',
      evidence: [
        {
          kind: 'file_line',
          ref: 'Dockerfile:37',
        },
      ],
    },
    {
      id: 'npm:postinstall-hook',
      kind: 'npm-script',
      evidence: [
        {
          kind: 'file_line',
          ref: 'package.json:44',
        },
      ],
    },
    {
      id: 'fs:scripts/postinstall-prisma-generate.mjs',
      kind: 'fs-path',
      evidence: [
        {
          kind: 'file_line',
          ref: 'scripts/postinstall-prisma-generate.mjs:1',
        },
      ],
    },
    {
      id: 'fs:scripts/copy-cesium-assets.cjs',
      kind: 'fs-path',
      evidence: [
        {
          kind: 'file_line',
          ref: 'scripts/copy-cesium-assets.cjs:1',
        },
      ],
    },
    {
      id: 'dockerfile.gcp:working-pattern',
      kind: 'docker-stage',
      evidence: [
        {
          kind: 'file_line',
          ref: 'Dockerfile.gcp:26,28,51,53',
        },
      ],
    },
    {
      id: 'docker-compose.staging.yml:web-target',
      kind: 'governed-build-contract',
      evidence: [
        {
          kind: 'file_line',
          ref: 'docker-compose.staging.yml:6-8',
        },
      ],
    },
  ],
  edges: [
    {
      from: 'dockerfile:production-base',
      to: 'npm:ci',
      relationType: 'invokes',
      evidence: [
        {
          kind: 'file_line',
          ref: 'Dockerfile:37',
        },
      ],
    },
    {
      from: 'npm:ci',
      to: 'npm:postinstall-hook',
      relationType: 'invokes',
      evidence: [
        {
          kind: 'file_line',
          ref: 'package.json:44',
        },
      ],
    },
    {
      from: 'npm:postinstall-hook',
      to: 'fs:scripts/postinstall-prisma-generate.mjs',
      relationType: 'requires-present',
      evidence: [
        {
          kind: 'runtime_result',
          ref: 'local npm-ci reproduction, 2026-09-30: MODULE_NOT_FOUND for exactly this path',
        },
      ],
    },
    {
      from: 'npm:postinstall-hook',
      to: 'fs:scripts/copy-cesium-assets.cjs',
      relationType: 'requires-present',
      evidence: [
        {
          kind: 'file_line',
          ref: 'package.json:44',
        },
      ],
    },
    {
      from: 'dockerfile:builder',
      to: 'npm:ci',
      relationType: 'invokes',
      evidence: [
        {
          kind: 'file_line',
          ref: 'Dockerfile:20',
        },
      ],
    },
    {
      from: 'docker-compose.staging.yml:web-target',
      to: 'dockerfile:production-base',
      relationType: 'verifies-against',
      evidence: [
        {
          kind: 'file_line',
          ref: 'Dockerfile:58',
          note: 'web target is FROM production-base',
        },
      ],
    },
  ],
} as const;

export const FROZEN_TARGET_DECISION_GATE = {
  items: [
    {
      item: 'Does a fix require inventing a new approach, or does one already exist in this repo?',
      classification: 'MECHANICAL',
      derivation:
        'Dockerfile.gcp already solves this exact class of problem (--ignore-scripts + explicit npx prisma generate) and is the actually-deployed definition. A fix for the plain Dockerfile can follow the same already-proven pattern rather than requiring new design.',
    },
    {
      item: 'Should the fix be scoped to just production-base, or also to builder (which has the identical defect for the identical reason)?',
      classification: 'MECHANICAL',
      derivation:
        'Both stages exhibit the same missing-edge defect in the same DependencyGraphArtifact sense (§5.2); fixing one and leaving the structurally identical defect in the other would not close the actual authority claim (the declared staging web build must succeed) since builder also needs to succeed for that build to complete at all.',
    },
    {
      item: 'Who selects the concrete implementation mechanism (--ignore-scripts plus explicit generation, COPY reordering, or another implementation that satisfies the same frozen contract)?',
      classification: 'MECHANICAL',
      derivation:
        'This is writer-lane implementation discretion, not an owner-level semantic or authority decision. The writer may choose any mechanism that closes both RED probes, remains inside the allowed paths, preserves the declared staging build contract, and does not alter proof policy or acceptance criteria. The DecisionGate therefore does not stop before WRITER.',
    },
  ],
} as const;

export const FROZEN_TARGET_RED_PLAN = {
  probes: [
    {
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
    },
    {
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
    },
  ],
} as const;
