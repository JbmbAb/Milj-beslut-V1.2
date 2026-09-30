/**
 * PATTERN-PROOF-ENGINE-01 V1 -- JSON-Schema (draft-07 SUBSET) objects, one per artifact kind.
 *
 * These describe the SHAPES of BOOTSTRAP design section 2 for the orchestrator adapter (Workflow
 * `agent({ schema })`, Ajv draft-07 vocabulary, validateFormats:false). Only the keywords in
 * `PPE_SCHEMA_KEYWORDS` (./schema-subset.ts) may appear: no $schema, $id, format, const, pattern,
 * if/then/else. Everything semantic (sha formats, dangling edges, evidence grounds, secret scans,
 * ...) is enforced by ./validators.ts, which the adapter runs through `ppe-cli validate` after the
 * structural check.
 *
 * `required` is always a subset of `properties`, and `additionalProperties:false` appears only on
 * objects whose complete key set is declared (harness contradiction check).
 */
import { DECISION_CLASSIFICATIONS, DEPENDENCY_RELATION_TYPES, EVIDENCE_GROUNDS } from './artifacts';
import { ALLOWED_PATHS_RESULTS, VERIFICATION_VERDICTS } from './artifacts';
import { EVIDENCE_LOCATOR_KINDS } from './evidence';
import type { PatternProofArtifactKind } from './identity';
import type { SubsetSchema } from './schema-subset';

const nonEmptyString: SubsetSchema = { type: 'string' };

const evidenceLocatorSchema: SubsetSchema = {
  type: 'object',
  description: 'EvidenceLocator: a resolvable, governed source (frozen design section 8)',
  properties: {
    kind: { type: 'string', enum: [...EVIDENCE_LOCATOR_KINDS] },
    ref: nonEmptyString,
    note: { type: 'string' },
  },
  required: ['kind', 'ref'],
  additionalProperties: false,
};

const evidenceListSchema: SubsetSchema = {
  type: 'array',
  items: evidenceLocatorSchema,
  minItems: 1,
};

const stringRecordSchema: SubsetSchema = {
  type: 'object',
  additionalProperties: { type: 'string' },
};

export const DISCOVERY_SCHEMA: SubsetSchema = {
  type: 'object',
  description: 'DiscoveryArtifact (BOOTSTRAP section 2)',
  properties: {
    findings: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          category: nonEmptyString,
          description: nonEmptyString,
          evidence: evidenceListSchema,
        },
        required: ['category', 'description', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
};

export const DEPENDENCY_GRAPH_SCHEMA: SubsetSchema = {
  type: 'object',
  description: 'DependencyGraphArtifact (BOOTSTRAP section 2)',
  properties: {
    nodes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: nonEmptyString,
          kind: nonEmptyString,
          evidence: evidenceListSchema,
        },
        required: ['id', 'kind', 'evidence'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: nonEmptyString,
          to: nonEmptyString,
          relationType: { type: 'string', enum: [...DEPENDENCY_RELATION_TYPES] },
          evidence: evidenceListSchema,
        },
        required: ['from', 'to', 'relationType', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['nodes', 'edges'],
  additionalProperties: false,
};

export const DECISION_GATE_SCHEMA: SubsetSchema = {
  type: 'object',
  description:
    'DecisionGateArtifact (BOOTSTRAP section 2; MECHANICAL needs derivation, others blockingReason)',
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          item: nonEmptyString,
          classification: { type: 'string', enum: [...DECISION_CLASSIFICATIONS] },
          derivation: { type: 'string' },
          blockingReason: { type: 'string' },
        },
        required: ['item', 'classification'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

export const RED_PLAN_SCHEMA: SubsetSchema = {
  type: 'object',
  description: 'RedPlanArtifact (BOOTSTRAP section 2; every probe cites its governed authority)',
  properties: {
    probes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: nonEmptyString,
          assertedBehavior: nonEmptyString,
          authorityEvidence: evidenceLocatorSchema,
          command: nonEmptyString,
        },
        required: ['id', 'assertedBehavior', 'authorityEvidence', 'command'],
        additionalProperties: false,
      },
    },
  },
  required: ['probes'],
  additionalProperties: false,
};

export const CANDIDATE_SCHEMA: SubsetSchema = {
  type: 'object',
  description: 'CandidateArtifact (BOOTSTRAP section 2; frozen writer output)',
  properties: {
    candidateSha: nonEmptyString,
    baseSha: nonEmptyString,
    diffRef: evidenceLocatorSchema,
    allowedPathsCompliance: {
      type: 'object',
      properties: {
        result: { type: 'string', enum: [...ALLOWED_PATHS_RESULTS] },
        allowedPaths: { type: 'array', items: nonEmptyString },
        evidence: evidenceListSchema,
      },
      required: ['result', 'allowedPaths', 'evidence'],
      additionalProperties: false,
    },
  },
  required: ['candidateSha', 'baseSha', 'diffRef', 'allowedPathsCompliance'],
  additionalProperties: false,
};

export const PATTERN_VERIFICATION_SCHEMA: SubsetSchema = {
  type: 'object',
  description: 'PatternVerificationArtifact (BOOTSTRAP section 2; one verdict per round)',
  properties: {
    claims: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          claim: nonEmptyString,
          evidenceGrounds: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', enum: [...EVIDENCE_GROUNDS] },
          },
          materialInvariant: { type: 'boolean' },
        },
        required: ['claim', 'evidenceGrounds', 'materialInvariant'],
        additionalProperties: false,
      },
    },
    verdict: { type: 'string', enum: [...VERIFICATION_VERDICTS] },
    reasonCode: { type: 'string' },
    isolationEvidence: { type: 'array', items: evidenceLocatorSchema },
  },
  required: ['claims', 'verdict', 'isolationEvidence'],
  additionalProperties: false,
};

export const INPUT_MANIFEST_SCHEMA: SubsetSchema = {
  type: 'object',
  description: 'InputManifest (BOOTSTRAP section 2; secrets excluded by value)',
  properties: {
    baseSha: nonEmptyString,
    candidateShaOrDiff: nonEmptyString,
    dependencyLockHash: nonEmptyString,
    fixtureContentHashes: stringRecordSchema,
    toolchainIdentity: nonEmptyString,
    environmentConfig: stringRecordSchema,
    secretBackedAuthority: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          keyId: nonEmptyString,
          providerRef: nonEmptyString,
        },
        required: ['keyId', 'providerRef'],
        additionalProperties: false,
      },
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
  additionalProperties: false,
};

export const PROOF_PACKAGE_SCHEMA: SubsetSchema = {
  type: 'object',
  description: 'ProofPackage (BOOTSTRAP section 2; trigger for owner push-go, never PROVEN by itself)',
  properties: {
    candidateSha: nonEmptyString,
    baseSha: nonEmptyString,
    tree: nonEmptyString,
    probeIdentities: { type: 'array', items: nonEmptyString },
    verifierAuthority: nonEmptyString,
    provenInvariants: { type: 'array', minItems: 1, items: nonEmptyString },
    inputManifest: INPUT_MANIFEST_SCHEMA,
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
  additionalProperties: false,
};

export const PPE_ARTIFACT_SCHEMAS: Readonly<Record<PatternProofArtifactKind, SubsetSchema>> = Object.freeze({
  discovery: DISCOVERY_SCHEMA,
  'dependency-graph': DEPENDENCY_GRAPH_SCHEMA,
  'decision-gate': DECISION_GATE_SCHEMA,
  'red-plan': RED_PLAN_SCHEMA,
  candidate: CANDIDATE_SCHEMA,
  'pattern-verification': PATTERN_VERIFICATION_SCHEMA,
  'input-manifest': INPUT_MANIFEST_SCHEMA,
  'proof-package': PROOF_PACKAGE_SCHEMA,
});
