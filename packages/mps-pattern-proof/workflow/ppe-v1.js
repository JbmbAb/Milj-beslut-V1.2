/* global agent, pipeline, parallel, phase, log, args, budget, workflow */
export const meta = {
  name: 'ppe-v1',
  description:
    'PATTERN-PROOF-ENGINE-01 V1 orchestrator adapter, BOOTSTRAP_RED_ONLY only: DISCOVER -> BUILD_GRAPH -> DECISION_GATE -> RED_SYNTHESIS over the target build-ordering defect, each stage a schema-validated agent that writes its artifact under args.evidenceDir and validates it with ppe-cli; the authoritative verdict is `ppe-cli run` (the pure state machine), never this script. Refuses every other mode before any agent runs (BOOTSTRAP design section 7).',
  whenToUse:
    'Only when the owner fires PATTERN-PROOF-ENGINE-V1 in mode BOOTSTRAP_RED_ONLY with args { mode, runStamp, baseSha, evidenceDir, target: { dockerfile, stages } }. Produces evidence only: no Dockerfile fix, no WRITER, no PR, no PROVEN claim.',
  phases: [
    { title: 'DISCOVER' },
    { title: 'BUILD_GRAPH' },
    { title: 'DECISION_GATE' },
    { title: 'RED_SYNTHESIS' },
  ],
};

// BEGIN GENERATED SCHEMAS (do not edit; run: npx tsx packages/mps-pattern-proof/scripts/gen-workflow-adapter.ts)
const PPE_SCHEMAS = {
  candidate: {
    additionalProperties: false,
    description: 'CandidateArtifact (BOOTSTRAP section 2; frozen writer output)',
    properties: {
      allowedPathsCompliance: {
        additionalProperties: false,
        properties: {
          allowedPaths: {
            items: {
              type: 'string',
            },
            type: 'array',
          },
          evidence: {
            items: {
              additionalProperties: false,
              description: 'EvidenceLocator: a resolvable, governed source (frozen design section 8)',
              properties: {
                kind: {
                  enum: [
                    'file_line',
                    'cas_artifact',
                    'git_object',
                    'postgis_ref',
                    'signed_attestation',
                    'runtime_result',
                  ],
                  type: 'string',
                },
                note: {
                  type: 'string',
                },
                ref: {
                  type: 'string',
                },
              },
              required: ['kind', 'ref'],
              type: 'object',
            },
            minItems: 1,
            type: 'array',
          },
          result: {
            enum: ['PASS', 'FAIL'],
            type: 'string',
          },
        },
        required: ['result', 'allowedPaths', 'evidence'],
        type: 'object',
      },
      baseSha: {
        type: 'string',
      },
      candidateSha: {
        type: 'string',
      },
      diffRef: {
        additionalProperties: false,
        description: 'EvidenceLocator: a resolvable, governed source (frozen design section 8)',
        properties: {
          kind: {
            enum: [
              'file_line',
              'cas_artifact',
              'git_object',
              'postgis_ref',
              'signed_attestation',
              'runtime_result',
            ],
            type: 'string',
          },
          note: {
            type: 'string',
          },
          ref: {
            type: 'string',
          },
        },
        required: ['kind', 'ref'],
        type: 'object',
      },
    },
    required: ['candidateSha', 'baseSha', 'diffRef', 'allowedPathsCompliance'],
    type: 'object',
  },
  'decision-gate': {
    additionalProperties: false,
    description:
      'DecisionGateArtifact (BOOTSTRAP section 2; MECHANICAL needs derivation, others blockingReason)',
    properties: {
      items: {
        items: {
          additionalProperties: false,
          properties: {
            blockingReason: {
              type: 'string',
            },
            classification: {
              enum: ['MECHANICAL', 'HUMAN_DECISION_REQUIRED', 'MISSING_AUTHORITY', 'SCOPE_VIOLATION'],
              type: 'string',
            },
            derivation: {
              type: 'string',
            },
            item: {
              type: 'string',
            },
          },
          required: ['item', 'classification'],
          type: 'object',
        },
        minItems: 1,
        type: 'array',
      },
    },
    required: ['items'],
    type: 'object',
  },
  'dependency-graph': {
    additionalProperties: false,
    description: 'DependencyGraphArtifact (BOOTSTRAP section 2)',
    properties: {
      edges: {
        items: {
          additionalProperties: false,
          properties: {
            evidence: {
              items: {
                additionalProperties: false,
                description: 'EvidenceLocator: a resolvable, governed source (frozen design section 8)',
                properties: {
                  kind: {
                    enum: [
                      'file_line',
                      'cas_artifact',
                      'git_object',
                      'postgis_ref',
                      'signed_attestation',
                      'runtime_result',
                    ],
                    type: 'string',
                  },
                  note: {
                    type: 'string',
                  },
                  ref: {
                    type: 'string',
                  },
                },
                required: ['kind', 'ref'],
                type: 'object',
              },
              minItems: 1,
              type: 'array',
            },
            from: {
              type: 'string',
            },
            relationType: {
              enum: ['imports', 'calls', 'binds-to', 'verifies-against', 'invokes', 'requires-present'],
              type: 'string',
            },
            to: {
              type: 'string',
            },
          },
          required: ['from', 'to', 'relationType', 'evidence'],
          type: 'object',
        },
        type: 'array',
      },
      nodes: {
        items: {
          additionalProperties: false,
          properties: {
            evidence: {
              items: {
                additionalProperties: false,
                description: 'EvidenceLocator: a resolvable, governed source (frozen design section 8)',
                properties: {
                  kind: {
                    enum: [
                      'file_line',
                      'cas_artifact',
                      'git_object',
                      'postgis_ref',
                      'signed_attestation',
                      'runtime_result',
                    ],
                    type: 'string',
                  },
                  note: {
                    type: 'string',
                  },
                  ref: {
                    type: 'string',
                  },
                },
                required: ['kind', 'ref'],
                type: 'object',
              },
              minItems: 1,
              type: 'array',
            },
            id: {
              type: 'string',
            },
            kind: {
              type: 'string',
            },
          },
          required: ['id', 'kind', 'evidence'],
          type: 'object',
        },
        minItems: 1,
        type: 'array',
      },
    },
    required: ['nodes', 'edges'],
    type: 'object',
  },
  discovery: {
    additionalProperties: false,
    description: 'DiscoveryArtifact (BOOTSTRAP section 2)',
    properties: {
      findings: {
        items: {
          additionalProperties: false,
          properties: {
            category: {
              type: 'string',
            },
            description: {
              type: 'string',
            },
            evidence: {
              items: {
                additionalProperties: false,
                description: 'EvidenceLocator: a resolvable, governed source (frozen design section 8)',
                properties: {
                  kind: {
                    enum: [
                      'file_line',
                      'cas_artifact',
                      'git_object',
                      'postgis_ref',
                      'signed_attestation',
                      'runtime_result',
                    ],
                    type: 'string',
                  },
                  note: {
                    type: 'string',
                  },
                  ref: {
                    type: 'string',
                  },
                },
                required: ['kind', 'ref'],
                type: 'object',
              },
              minItems: 1,
              type: 'array',
            },
          },
          required: ['category', 'description', 'evidence'],
          type: 'object',
        },
        minItems: 1,
        type: 'array',
      },
    },
    required: ['findings'],
    type: 'object',
  },
  'input-manifest': {
    additionalProperties: false,
    description: 'InputManifest (BOOTSTRAP section 2; secrets excluded by value)',
    properties: {
      baseSha: {
        type: 'string',
      },
      candidateShaOrDiff: {
        type: 'string',
      },
      dependencyLockHash: {
        type: 'string',
      },
      environmentConfig: {
        additionalProperties: {
          type: 'string',
        },
        type: 'object',
      },
      fixtureContentHashes: {
        additionalProperties: {
          type: 'string',
        },
        type: 'object',
      },
      secretBackedAuthority: {
        items: {
          additionalProperties: false,
          properties: {
            keyId: {
              type: 'string',
            },
            providerRef: {
              type: 'string',
            },
          },
          required: ['keyId', 'providerRef'],
          type: 'object',
        },
        type: 'array',
      },
      toolchainIdentity: {
        type: 'string',
      },
    },
    required: [
      'baseSha',
      'candidateShaOrDiff',
      'dependencyLockHash',
      'fixtureContentHashes',
      'toolchainIdentity',
      'environmentConfig',
    ],
    type: 'object',
  },
  'pattern-verification': {
    additionalProperties: false,
    description: 'PatternVerificationArtifact (BOOTSTRAP section 2; one verdict per round)',
    properties: {
      claims: {
        items: {
          additionalProperties: false,
          properties: {
            claim: {
              type: 'string',
            },
            evidenceGrounds: {
              items: {
                enum: ['VERIFIER_OWNED_PROBE', 'INDEPENDENT_CODE_DERIVATION', 'WRITER_TEST_REGRESSION'],
                type: 'string',
              },
              minItems: 1,
              type: 'array',
            },
            materialInvariant: {
              type: 'boolean',
            },
          },
          required: ['claim', 'evidenceGrounds', 'materialInvariant'],
          type: 'object',
        },
        minItems: 1,
        type: 'array',
      },
      isolationEvidence: {
        items: {
          additionalProperties: false,
          description: 'EvidenceLocator: a resolvable, governed source (frozen design section 8)',
          properties: {
            kind: {
              enum: [
                'file_line',
                'cas_artifact',
                'git_object',
                'postgis_ref',
                'signed_attestation',
                'runtime_result',
              ],
              type: 'string',
            },
            note: {
              type: 'string',
            },
            ref: {
              type: 'string',
            },
          },
          required: ['kind', 'ref'],
          type: 'object',
        },
        type: 'array',
      },
      reasonCode: {
        type: 'string',
      },
      verdict: {
        enum: ['ACCEPT', 'FALSIFIED', 'NOT_PROVEN'],
        type: 'string',
      },
    },
    required: ['claims', 'verdict', 'isolationEvidence'],
    type: 'object',
  },
  'proof-package': {
    additionalProperties: false,
    description: 'ProofPackage (BOOTSTRAP section 2; trigger for owner push-go, never PROVEN by itself)',
    properties: {
      baseSha: {
        type: 'string',
      },
      candidateSha: {
        type: 'string',
      },
      inputManifest: {
        additionalProperties: false,
        description: 'InputManifest (BOOTSTRAP section 2; secrets excluded by value)',
        properties: {
          baseSha: {
            type: 'string',
          },
          candidateShaOrDiff: {
            type: 'string',
          },
          dependencyLockHash: {
            type: 'string',
          },
          environmentConfig: {
            additionalProperties: {
              type: 'string',
            },
            type: 'object',
          },
          fixtureContentHashes: {
            additionalProperties: {
              type: 'string',
            },
            type: 'object',
          },
          secretBackedAuthority: {
            items: {
              additionalProperties: false,
              properties: {
                keyId: {
                  type: 'string',
                },
                providerRef: {
                  type: 'string',
                },
              },
              required: ['keyId', 'providerRef'],
              type: 'object',
            },
            type: 'array',
          },
          toolchainIdentity: {
            type: 'string',
          },
        },
        required: [
          'baseSha',
          'candidateShaOrDiff',
          'dependencyLockHash',
          'fixtureContentHashes',
          'toolchainIdentity',
          'environmentConfig',
        ],
        type: 'object',
      },
      probeIdentities: {
        items: {
          type: 'string',
        },
        type: 'array',
      },
      provenInvariants: {
        items: {
          type: 'string',
        },
        minItems: 1,
        type: 'array',
      },
      tree: {
        type: 'string',
      },
      verifierAuthority: {
        type: 'string',
      },
    },
    required: [
      'candidateSha',
      'baseSha',
      'tree',
      'probeIdentities',
      'verifierAuthority',
      'provenInvariants',
      'inputManifest',
    ],
    type: 'object',
  },
  'red-plan': {
    additionalProperties: false,
    description: 'RedPlanArtifact (BOOTSTRAP section 2; every probe cites its governed authority)',
    properties: {
      probes: {
        items: {
          additionalProperties: false,
          properties: {
            assertedBehavior: {
              type: 'string',
            },
            authorityEvidence: {
              additionalProperties: false,
              description: 'EvidenceLocator: a resolvable, governed source (frozen design section 8)',
              properties: {
                kind: {
                  enum: [
                    'file_line',
                    'cas_artifact',
                    'git_object',
                    'postgis_ref',
                    'signed_attestation',
                    'runtime_result',
                  ],
                  type: 'string',
                },
                note: {
                  type: 'string',
                },
                ref: {
                  type: 'string',
                },
              },
              required: ['kind', 'ref'],
              type: 'object',
            },
            command: {
              type: 'string',
            },
            id: {
              type: 'string',
            },
          },
          required: ['id', 'assertedBehavior', 'authorityEvidence', 'command'],
          type: 'object',
        },
        minItems: 1,
        type: 'array',
      },
    },
    required: ['probes'],
    type: 'object',
  },
};
// END GENERATED SCHEMAS

// ---------------------------------------------------------------------------------------------
// Hand-written control flow (BOOTSTRAP design section 4; plan section 7 as amended by section 12
// D2, D3, D7, D14, T4, T5, T13). Plain JavaScript: no imports, no fs, no Date.now/Math.random.
// ---------------------------------------------------------------------------------------------

const MODE = 'BOOTSTRAP_RED_ONLY';
const REFUSAL =
  'FULL_PATTERN_PROOF is a separate unit requiring its own review and go (BOOTSTRAP design section 7); this adapter implements BOOTSTRAP_RED_ONLY only';
const PPE_CLI = 'npx tsx packages/mps-pattern-proof/scripts/ppe-cli.ts';
const RED_PROBE_CLI = 'npx tsx packages/mps-pattern-proof/scripts/red-probe.ts';
const DEFAULT_DOCKERFILE = 'Dockerfile';
const DEFAULT_STAGES = ['production-base', 'builder'];

// Fail closed unless the full Workflow runtime API is present: this script has no other way to act.
const RUNTIME_API = { agent, pipeline, parallel, phase, log, workflow };
for (const name of Object.keys(RUNTIME_API)) {
  if (typeof RUNTIME_API[name] !== 'function') {
    return { refused: `Workflow runtime API "${name}" is not available; nothing was run` };
  }
}
if (budget === null || typeof budget !== 'object') {
  return { refused: 'Workflow runtime API "budget" is not available; nothing was run' };
}

const input = args !== null && typeof args === 'object' ? args : {};

// D2: hard refusal of any other mode BEFORE any agent() call; no ownerGo bypass exists.
if (input.mode !== MODE) {
  return { refused: REFUSAL, mode: input.mode === undefined ? null : input.mode };
}
for (const required of ['evidenceDir', 'runStamp', 'baseSha']) {
  if (typeof input[required] !== 'string' || input[required].length === 0) {
    return { refused: `args.${required} is required (a non-empty string); nothing was run` };
  }
}
// R2 F3: these values are interpolated into the command lines handed to agents, so they are
// constrained to a safe charset BEFORE any interpolation (no spaces, no shell metacharacters).
if (!/^[0-9a-f]{40}$/.test(input.baseSha)) {
  return { refused: 'args.baseSha must be a 40-hex git object id; nothing was run' };
}
for (const pathLike of ['evidenceDir', 'runStamp']) {
  if (!/^[A-Za-z0-9_./-]+$/.test(input[pathLike])) {
    return {
      refused: `args.${pathLike} must match ^[A-Za-z0-9_./-]+$ (no spaces, no shell metacharacters); nothing was run`,
    };
  }
}

const runStamp = input.runStamp;
const baseSha = input.baseSha;
const evidenceDir = input.evidenceDir;
const target = input.target !== null && typeof input.target === 'object' ? input.target : {};
const dockerfile =
  typeof target.dockerfile === 'string' && target.dockerfile.length > 0
    ? target.dockerfile
    : DEFAULT_DOCKERFILE;
const stages = Array.isArray(target.stages) && target.stages.length > 0 ? target.stages : DEFAULT_STAGES;

const artifactPaths = {
  discovery: `${evidenceDir}/discovery.json`,
  dependencyGraph: `${evidenceDir}/dependency-graph.json`,
  decisionGate: `${evidenceDir}/decision-gate.json`,
  redPlan: `${evidenceDir}/red-plan.json`,
  runtimeLedger: `${evidenceDir}/runtime-ledger.json`,
  runState: `${evidenceDir}/run-state.json`,
  probes: stages.map((stage) => `${evidenceDir}/probe-${stage}.json`),
};

/** What every stage agent returns: the artifact (schema-checked here), the CLI verdict, the path written. */
const STAGE_SCHEMA = (kind) => ({
  type: 'object',
  properties: {
    artifact: PPE_SCHEMAS[kind],
    validation: {
      type: 'object',
      properties: { ok: { type: 'boolean' }, errors: { type: 'array', items: { type: 'string' } } },
      required: ['ok', 'errors'],
    },
    artifactPath: { type: 'string' },
  },
  required: ['artifact', 'validation', 'artifactPath'],
});

const RUN_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    exitCode: { type: 'number' },
    phase: { type: 'string' },
    terminalState: { type: 'string' },
    stoppedAtPhase: { type: 'string' },
    // R2 F3: the machine's own stop record as ppe-cli prints it; required by the success gate below
    stoppedByMode: {
      type: 'object',
      properties: { atPhase: { type: 'string' }, reason: { type: 'string' } },
      required: ['atPhase', 'reason'],
    },
    storedArtifacts: { type: 'array', items: { type: 'string' } },
  },
  required: ['exitCode', 'phase', 'storedArtifacts'],
};

const PROBE_RESULTS_SCHEMA = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    properties: {
      stage: { type: 'string' },
      exitCode: { type: 'number' },
      classification: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED'] },
      reasonCode: { type: 'string' },
      fidelity: { type: 'string' },
    },
    required: ['stage', 'exitCode', 'classification', 'reasonCode', 'fidelity'],
  },
};

const RED_SYNTHESIS_SCHEMA = (() => {
  const base = STAGE_SCHEMA('red-plan');
  return {
    type: 'object',
    properties: { ...base.properties, runSummary: RUN_SUMMARY_SCHEMA, probeResults: PROBE_RESULTS_SCHEMA },
    required: [...base.required, 'runSummary', 'probeResults'],
  };
})();

const COMMON_RULES = [
  'Hard rules for this stage:',
  '- Every EvidenceLocator you emit is { kind, ref, note? } with kind in file_line | git_object | cas_artifact | signed_attestation | runtime_result | postgis_ref. A file_line ref is `path:N`, `path:N-M` or `path:N,M,...` relative to the repository root, with CURRENT line numbers that you verified by reading the file in this stage. Never cite a locator you did not verify.',
  '- A runtime_result locator may only be emitted if you actually executed the reproduction it describes; then append the exact ref string, verbatim, to the JSON array in ' +
    artifactPaths.runtimeLedger +
    ' (create the file as `[]` first if absent) and nowhere else. Never invent runtime results.',
  '- Do not modify Dockerfile, Dockerfile.gcp, Dockerfile.fly, docker-compose*.yml, package.json, package-lock.json or anything under .github/. Do not commit. Do not open a PR. Write only under ' +
    evidenceDir +
    ' (mkdir -p it) and, for reproductions, under the OS temp directory.',
  '- After writing the artifact file, run the validation command exactly as given and report its printed JSON in `validation` as { ok: <printed ok>, errors: [<each printed error rendered as "code: message">] }. Return the artifact only as you wrote it to disk; if validation printed ok:false, still return honestly with validation.ok=false (this script fails closed on it).',
  '- Return { artifact, validation, artifactPath } and nothing else.',
].join('\n');

function stageIsAdmissible(result) {
  return (
    result !== null &&
    typeof result === 'object' &&
    result.validation !== null &&
    typeof result.validation === 'object' &&
    result.validation.ok === true &&
    result.artifact !== null &&
    typeof result.artifact === 'object'
  );
}

function failClosed(atPhase, reason, extra) {
  log(`ppe-v1 ${runStamp}: FAILED CLOSED at ${atPhase}: ${reason}`);
  return {
    mode: MODE,
    runStamp,
    baseSha,
    evidenceDir,
    failedClosed: true,
    atPhase,
    reason,
    artifactPaths,
    ...extra,
  };
}

function describeStageFailure(result) {
  if (result === null) return 'agent returned null (skipped or terminal API error)';
  if (typeof result !== 'object') return `agent returned a non-object (${typeof result})`;
  if (result.validation === null || typeof result.validation !== 'object')
    return 'no validation record returned';
  if (result.validation.ok !== true) {
    const errors = Array.isArray(result.validation.errors) ? result.validation.errors.join('; ') : '';
    return `ppe-cli validate reported ok:false${errors.length > 0 ? `: ${errors}` : ''}`;
  }
  return 'no artifact object returned';
}

function validateCommand(kind, artifactPath) {
  return `${PPE_CLI} validate --kind ${kind} --file ${artifactPath}`;
}

/** What `ppe-cli run` must have stored for a stop-by-mode at RED_SYNTHESIS to be the real one. */
const REQUIRED_STORED_ARTIFACTS = ['discovery', 'dependency-graph', 'decision-gate', 'red-plan'];
const PROBE_CLASSIFICATIONS = ['PASS', 'FAIL', 'BLOCKED'];

/**
 * R2 F3: the RED_SYNTHESIS relay must be complete and self-consistent before the success return:
 * the machine's phase is RED_SYNTHESIS, it stopped by THIS mode there, every artifact of the four
 * stages is stored, and there is exactly one classified probe result per target stage. Returns the
 * fault text, or null when the relay is admissible.
 */
function describeRelayFault(runSummary, probeResults) {
  if (runSummary.phase !== 'RED_SYNTHESIS') {
    return `ppe-cli run reports phase ${runSummary.phase}, not RED_SYNTHESIS`;
  }
  const stop = runSummary.stoppedByMode;
  if (stop === null || typeof stop !== 'object' || stop.reason !== MODE || stop.atPhase !== 'RED_SYNTHESIS') {
    return `ppe-cli run did not record stoppedByMode { atPhase: RED_SYNTHESIS, reason: ${MODE} } (got ${JSON.stringify(stop === undefined ? null : stop)})`;
  }
  const stored = Array.isArray(runSummary.storedArtifacts) ? runSummary.storedArtifacts : [];
  const missing = REQUIRED_STORED_ARTIFACTS.filter((kind) => !stored.includes(kind));
  if (missing.length > 0)
    return `ppe-cli run did not store ${missing.join(', ')} (storedArtifacts ${JSON.stringify(stored)})`;
  if (probeResults.length !== stages.length) {
    return `expected exactly ${stages.length} probe result(s), one per stage [${stages.join(', ')}], got ${probeResults.length}`;
  }
  for (const stage of stages) {
    const forStage = probeResults.filter(
      (result) => result !== null && typeof result === 'object' && result.stage === stage,
    );
    if (forStage.length !== 1)
      return `stage ${stage} has ${forStage.length} probe result(s), expected exactly one`;
    if (!PROBE_CLASSIFICATIONS.includes(forStage[0].classification)) {
      return `probe result for stage ${stage} carries no classification (PASS | FAIL | BLOCKED)`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// DISCOVER
// ---------------------------------------------------------------------------------------------

phase('DISCOVER');
log(
  `ppe-v1 ${runStamp}: mode ${MODE}, baseSha ${baseSha}, target ${dockerfile} stages [${stages.join(', ')}], evidence under ${evidenceDir}`,
);

const discover = await agent(
  [
    `You are the DISCOVER stage of PATTERN-PROOF-ENGINE-01 V1 (mode ${MODE}, run ${runStamp}, base ${baseSha}).`,
    '',
    `Investigate the target build-ordering defect in THIS repository itself: the root ${dockerfile} runs an npm dependency-install step in one or more stages (${stages.join(', ')}) while only package*.json (and possibly tsconfig.json) are present in the image, yet package.json declares lifecycle scripts (preinstall/install/postinstall/prepare) that execute node scripts which are not yet copied at that point. Read, at minimum: ${dockerfile}; package.json (the scripts block); docker-compose.staging.yml (which Dockerfile/target the declared staging build uses); Dockerfile.gcp (how it orders or flags its own install step); and every .github/workflows/deploy-*.yml (which build contract deploys use). Investigate the repository, not the problem statement: report what the files say today.`,
    '',
    'Produce a DiscoveryArtifact: { findings: [{ category, description, evidence: [EvidenceLocator, ...] }] } with at least one finding, every finding carrying at least one verified locator. Categories are free text (e.g. build-ordering-defect, lifecycle-script, declared-build-contract, existing-mitigation, deploy-path).',
    '',
    `If you choose to execute a reproduction (an isolated npm install with only the files the stage has at its install step, under the OS temp directory; never in the checkout), record it as a runtime_result locator whose ref names what ran, the date, the exit status and the observed failure signature, and append that exact ref string to ${artifactPaths.runtimeLedger}.`,
    '',
    `Write the artifact to ${artifactPaths.discovery} (JSON). Then run: ${validateCommand('discovery', artifactPaths.discovery)}`,
    '',
    COMMON_RULES,
  ].join('\n'),
  { phase: 'DISCOVER', label: 'ppe-v1 DISCOVER', effort: 'high', schema: STAGE_SCHEMA('discovery') },
);
if (!stageIsAdmissible(discover)) return failClosed('DISCOVER', describeStageFailure(discover));
log(
  `ppe-v1 ${runStamp}: DISCOVER admissible (${discover.artifact.findings.length} finding(s)) at ${discover.artifactPath}`,
);

// ---------------------------------------------------------------------------------------------
// BUILD_GRAPH
// ---------------------------------------------------------------------------------------------

phase('BUILD_GRAPH');
const graph = await agent(
  [
    `You are the BUILD_GRAPH stage of PATTERN-PROOF-ENGINE-01 V1 (mode ${MODE}, run ${runStamp}, base ${baseSha}).`,
    '',
    `Read ONLY ${artifactPaths.discovery} (the DiscoveryArtifact written by the previous stage) plus the repository files it cites. You have no access to, and must not reconstruct, the previous agent's transcript or reasoning: the artifact file is your sole input from that stage.`,
    '',
    'Produce a DependencyGraphArtifact: { nodes: [{ id, kind, evidence }], edges: [{ from, to, relationType, evidence }] } where relationType is one of imports | calls | binds-to | verifies-against | invokes | requires-present, node ids are unique, and every edge endpoint names a declared node id. Model the Docker stages, their install steps, the package.json lifecycle scripts, the script files they require, the declared staging build contract and the deploy paths as nodes; model the ordering dependency (install step requires-present script files that a later COPY provides) as edges. Every locator must be drawn from the discovery evidence or be a file line you newly verified in this stage.',
    '',
    `Write the artifact to ${artifactPaths.dependencyGraph} (JSON). Then run: ${validateCommand('dependency-graph', artifactPaths.dependencyGraph)}`,
    '',
    COMMON_RULES,
  ].join('\n'),
  {
    phase: 'BUILD_GRAPH',
    label: 'ppe-v1 BUILD_GRAPH',
    effort: 'high',
    schema: STAGE_SCHEMA('dependency-graph'),
  },
);
if (!stageIsAdmissible(graph)) return failClosed('BUILD_GRAPH', describeStageFailure(graph));
log(
  `ppe-v1 ${runStamp}: BUILD_GRAPH admissible (${graph.artifact.nodes.length} node(s), ${graph.artifact.edges.length} edge(s)) at ${graph.artifactPath}`,
);

// ---------------------------------------------------------------------------------------------
// DECISION_GATE
// ---------------------------------------------------------------------------------------------

phase('DECISION_GATE');
const gate = await agent(
  [
    `You are the DECISION_GATE stage of PATTERN-PROOF-ENGINE-01 V1 (mode ${MODE}, run ${runStamp}, base ${baseSha}).`,
    '',
    `Read ONLY ${artifactPaths.discovery} and ${artifactPaths.dependencyGraph} plus the repository files they cite. Do not reconstruct earlier transcripts.`,
    '',
    'Produce a DecisionGateArtifact: { items: [{ item, classification, derivation?, blockingReason? }] }. Enumerate every decision that a fix for the defect would involve (does closing the defect require inventing a new mechanism or is one already declared in the repository; is the allowed change set inside the declared build contract; is any owner-level semantic, authority or scope decision required; is any authority missing). Classify each item MECHANICAL (then `derivation` must state the mechanical derivation from cited evidence) or HUMAN_DECISION_REQUIRED / MISSING_AUTHORITY / SCOPE_VIOLATION (then `blockingReason` must state exactly what blocks). Never classify an owner-level decision as MECHANICAL to keep the run going: a non-MECHANICAL item is a legitimate, evidenced stop.',
    '',
    `Write the artifact to ${artifactPaths.decisionGate} (JSON). Then run: ${validateCommand('decision-gate', artifactPaths.decisionGate)}`,
    '',
    COMMON_RULES,
  ].join('\n'),
  {
    phase: 'DECISION_GATE',
    label: 'ppe-v1 DECISION_GATE',
    effort: 'high',
    schema: STAGE_SCHEMA('decision-gate'),
  },
);
if (!stageIsAdmissible(gate)) return failClosed('DECISION_GATE', describeStageFailure(gate));

const nonMechanical = gate.artifact.items.find((item) => item.classification !== 'MECHANICAL');
if (nonMechanical !== undefined) {
  // Early return per BOOTSTRAP design section 4 (terminal states are ordinary control flow). This is
  // a CANDIDATE verdict only: the authoritative terminal record is produced by `ppe-cli run` over the
  // written artifacts (the pure state machine, plan D3), which the RED_SYNTHESIS stage would have run
  // and which the routine re-runs over the evidence directory. RED_SYNTHESIS is not called.
  log(
    `ppe-v1 ${runStamp}: DECISION_GATE stops the run: ${nonMechanical.classification} -- ${nonMechanical.blockingReason}`,
  );
  return {
    mode: MODE,
    runStamp,
    baseSha,
    evidenceDir,
    stoppedAt: 'DECISION_GATE',
    terminalCandidate: nonMechanical.classification,
    blockingReason: typeof nonMechanical.blockingReason === 'string' ? nonMechanical.blockingReason : null,
    item: nonMechanical.item,
    authoritativeVerdict: `${PPE_CLI} run --dir ${evidenceDir} --mode ${MODE} --repo-root . --run-id ${runStamp} --base-sha ${baseSha} --json (not executed by this script; RED_SYNTHESIS was not called)`,
    artifactPaths,
  };
}
log(
  `ppe-v1 ${runStamp}: DECISION_GATE all ${gate.artifact.items.length} item(s) MECHANICAL at ${gate.artifactPath}`,
);

// ---------------------------------------------------------------------------------------------
// RED_SYNTHESIS (the stop point of BOOTSTRAP_RED_ONLY: WRITER is never entered)
// ---------------------------------------------------------------------------------------------

phase('RED_SYNTHESIS');
const runCommand = `${PPE_CLI} run --dir ${evidenceDir} --mode ${MODE} --repo-root . --run-id ${runStamp} --base-sha ${baseSha} --json`;
const probeCommands = stages.map(
  (stage) =>
    `${RED_PROBE_CLI} --dockerfile ${dockerfile} --stage ${stage} --executor auto --json --out ${evidenceDir}/probe-${stage}.json`,
);
const red = await agent(
  [
    `You are the RED_SYNTHESIS stage of PATTERN-PROOF-ENGINE-01 V1 (mode ${MODE}, run ${runStamp}, base ${baseSha}).`,
    '',
    `Read ONLY ${artifactPaths.discovery}, ${artifactPaths.dependencyGraph} and ${artifactPaths.decisionGate} plus the repository files they cite. Do not reconstruct earlier transcripts.`,
    '',
    `1. Propose a RedPlanArtifact: { probes: [{ id, assertedBehavior, authorityEvidence: EvidenceLocator, command }] } with unique ids, one probe per target stage (${stages.join(', ')}). Each probe asserts BEHAVIOR, never implementation: e.g. "the stage's declared npm dependency-install step must complete without failing because package.json lifecycle-script dependencies are absent from the filesystem state that stage establishes before the install step" -- never "add --ignore-scripts" or "copy scripts/ first". Each authorityEvidence must be EXACTLY a locator (same kind and same ref) that is present in ${artifactPaths.discovery} or ${artifactPaths.dependencyGraph}; a locator absent from both makes the engine stop with MISSING_AUTHORITY (reason AUTHORITY_NOT_IN_DISCOVERY_OR_GRAPH). Write it to ${artifactPaths.redPlan}. Then run: ${validateCommand('red-plan', artifactPaths.redPlan)}`,
    '',
    `2. Run the authoritative replay: ${runCommand}`,
    'This replays the four artifact files through the pure state machine with a repository-rooted authority resolver and prints a JSON summary. Include that printed JSON VERBATIM as `runSummary` (at least exitCode, phase, storedArtifacts; plus stoppedAtPhase / terminalState when printed). Exit code 0 means the machine stopped by mode at RED_SYNTHESIS; 3 means a terminal state was reached (report it as printed, do not rewrite the plan to avoid it); 1 means an artifact was inadmissible; 2 means a harness fault. Never edit the earlier artifacts.',
    '',
    '3. Execute the solution-neutral RED probes, one per stage, each with its own command (they derive the stage prefix from the Dockerfile under test and classify the install output; exit 0 PASS, 1 FAIL = RED confirmed, 2 BLOCKED):',
    ...probeCommands.map((command) => `   ${command}`),
    'Report `probeResults`: [{ stage, exitCode, classification, reasonCode, fidelity }] read from each printed JSON / --out file (never from your own expectation). A BLOCKED probe is reported as BLOCKED.',
    '',
    'Return { artifact, validation, artifactPath, runSummary, probeResults }.',
    '',
    COMMON_RULES,
  ].join('\n'),
  { phase: 'RED_SYNTHESIS', label: 'ppe-v1 RED_SYNTHESIS', effort: 'high', schema: RED_SYNTHESIS_SCHEMA },
);
if (!stageIsAdmissible(red)) return failClosed('RED_SYNTHESIS', describeStageFailure(red));

const runSummary = red.runSummary;
const probeResults = Array.isArray(red.probeResults) ? red.probeResults : [];
if (runSummary === null || typeof runSummary !== 'object') {
  return failClosed('RED_SYNTHESIS', 'no runSummary returned from ppe-cli run', { probeResults });
}
if (runSummary.exitCode === 3) {
  // A legitimate, evidenced stop decided by the state machine (MISSING_AUTHORITY etc.).
  log(`ppe-v1 ${runStamp}: state machine reached terminal ${runSummary.terminalState} (ppe-cli run exit 3)`);
  return {
    mode: MODE,
    runStamp,
    baseSha,
    evidenceDir,
    stoppedAt: 'RED_SYNTHESIS',
    terminal: true,
    terminalState: typeof runSummary.terminalState === 'string' ? runSummary.terminalState : null,
    runSummary,
    probeResults,
    artifactPaths,
  };
}
if (runSummary.exitCode !== 0 || runSummary.stoppedAtPhase !== 'RED_SYNTHESIS') {
  return failClosed(
    'RED_SYNTHESIS',
    `ppe-cli run did not stop by mode at RED_SYNTHESIS (exitCode ${runSummary.exitCode}, phase ${runSummary.phase}, stoppedAtPhase ${runSummary.stoppedAtPhase})`,
    { runSummary, probeResults },
  );
}
// R2 F3: what this script sees is the agent's RELAY of the `ppe-cli run` summary and the probe
// outputs, never those outputs themselves (no fs/exec by design). The relay must be complete and
// self-consistent before the success return; the routine's independent `ppe-cli run` and probe
// re-execution over the evidence directory are the check on the relay itself.
const relayFault = describeRelayFault(runSummary, probeResults);
if (relayFault !== null) return failClosed('RED_SYNTHESIS', relayFault, { runSummary, probeResults });

log(
  `ppe-v1 ${runStamp}: stopped by mode at RED_SYNTHESIS; ${probeResults.length} probe result(s); WRITER never entered`,
);
return {
  mode: MODE,
  runStamp,
  baseSha,
  evidenceDir,
  stoppedAt: 'RED_SYNTHESIS',
  terminal: false,
  runSummary,
  probeResults,
  artifactPaths,
};
