/**
 * PATTERN-PROOF-ENGINE-01 V1 -- artifact TYPES (BOOTSTRAP design section 2, verbatim shapes).
 *
 * These are the mandatory semantic fields of the proof protocol (frozen design section 2): the
 * writer lane decides serialization, never what an artifact must contain to count as evidence.
 * Every field is readonly; validators (./validators.ts) return deep-frozen copies of these shapes.
 *
 * Naming (plan constraint 8): PPE's own nouns are `PatternProof*`; `VerificationArtifact`,
 * `DependencyGraph`, `EvidenceArtifact`, `Replay*` and `Workflow*` are deliberately NOT exported here.
 */
import type { EvidenceLocator } from './evidence';
import type { PatternProofArtifactKind } from './identity';

// ---------------------------------------------------------------------------------------------
// DISCOVER
// ---------------------------------------------------------------------------------------------

export interface DiscoveryFinding {
  /** e.g. "build-ordering-defect" */
  readonly category: string;
  readonly description: string;
  /** non-empty */
  readonly evidence: readonly EvidenceLocator[];
}

export interface DiscoveryArtifact {
  readonly findings: readonly DiscoveryFinding[];
}

// ---------------------------------------------------------------------------------------------
// BUILD_GRAPH
// ---------------------------------------------------------------------------------------------

export const DEPENDENCY_RELATION_TYPES = [
  'imports',
  'calls',
  'binds-to',
  'verifies-against',
  'invokes',
  'requires-present',
] as const;

export type DependencyRelationType = (typeof DEPENDENCY_RELATION_TYPES)[number];

export interface DependencyGraphNode {
  readonly id: string;
  /** e.g. "docker-stage" | "npm-script" | "fs-path" */
  readonly kind: string;
  readonly evidence: readonly EvidenceLocator[];
}

export interface DependencyGraphEdge {
  /** node id */
  readonly from: string;
  /** node id */
  readonly to: string;
  readonly relationType: DependencyRelationType;
  /** non-empty */
  readonly evidence: readonly EvidenceLocator[];
}

export interface DependencyGraphArtifact {
  readonly nodes: readonly DependencyGraphNode[];
  readonly edges: readonly DependencyGraphEdge[];
}

// ---------------------------------------------------------------------------------------------
// DECISION_GATE
// ---------------------------------------------------------------------------------------------

export const DECISION_CLASSIFICATIONS = [
  'MECHANICAL',
  'HUMAN_DECISION_REQUIRED',
  'MISSING_AUTHORITY',
  'SCOPE_VIOLATION',
] as const;

export type DecisionClassification = (typeof DECISION_CLASSIFICATIONS)[number];

export interface DecisionGateItem {
  readonly item: string;
  readonly classification: DecisionClassification;
  /** required if MECHANICAL */
  readonly derivation?: string;
  /** required if not MECHANICAL */
  readonly blockingReason?: string;
}

export interface DecisionGateArtifact {
  readonly items: readonly DecisionGateItem[];
}

// ---------------------------------------------------------------------------------------------
// RED_SYNTHESIS
// ---------------------------------------------------------------------------------------------

export interface RedProbe {
  readonly id: string;
  /** what must be false today (the correct RED state) */
  readonly assertedBehavior: string;
  /** frozen design section 8: the governed source this probe asserts against */
  readonly authorityEvidence: EvidenceLocator;
  /** human-readable description; exact invocation is GREEN-phase detail */
  readonly command: string;
}

export interface RedPlanArtifact {
  readonly probes: readonly RedProbe[];
}

// ---------------------------------------------------------------------------------------------
// WRITER output (frozen candidate)
// ---------------------------------------------------------------------------------------------

export const ALLOWED_PATHS_RESULTS = ['PASS', 'FAIL'] as const;

export type AllowedPathsResult = (typeof ALLOWED_PATHS_RESULTS)[number];

export interface AllowedPathsCompliance {
  readonly result: AllowedPathsResult;
  readonly allowedPaths: readonly string[];
  /** non-empty; derived from the actual candidate diff */
  readonly evidence: readonly EvidenceLocator[];
}

export interface CandidateArtifact {
  readonly candidateSha: string;
  readonly baseSha: string;
  /** resolvable Git/diff reference, not writer prose */
  readonly diffRef: EvidenceLocator;
  readonly allowedPathsCompliance: AllowedPathsCompliance;
}

// ---------------------------------------------------------------------------------------------
// VERIFY + ADVERSARIAL_PROBES (one artifact, frozen design sections 4-5)
// ---------------------------------------------------------------------------------------------

export const EVIDENCE_GROUNDS = [
  'VERIFIER_OWNED_PROBE',
  'INDEPENDENT_CODE_DERIVATION',
  'WRITER_TEST_REGRESSION',
] as const;

export type EvidenceGround = (typeof EVIDENCE_GROUNDS)[number];

/** The grounds that alone can carry a material invariant (frozen design section 5). */
export const MATERIAL_EVIDENCE_GROUNDS: readonly EvidenceGround[] = Object.freeze([
  'VERIFIER_OWNED_PROBE',
  'INDEPENDENT_CODE_DERIVATION',
]);

export interface VerificationClaim {
  readonly claim: string;
  /** non-empty */
  readonly evidenceGrounds: readonly EvidenceGround[];
  readonly materialInvariant: boolean;
}

export const VERIFICATION_VERDICTS = ['ACCEPT', 'FALSIFIED', 'NOT_PROVEN'] as const;

export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

export interface PatternVerificationArtifact {
  readonly claims: readonly VerificationClaim[];
  readonly verdict: VerificationVerdict;
  /** e.g. "VERIFICATION_BLOCKED"; required when verdict === 'NOT_PROVEN' */
  readonly reasonCode?: string;
  /** non-empty for ACCEPT or FALSIFIED (BOOTSTRAP section 4) */
  readonly isolationEvidence: readonly EvidenceLocator[];
}

// ---------------------------------------------------------------------------------------------
// ASSEMBLE_EVIDENCE
// ---------------------------------------------------------------------------------------------

export interface SecretBackedAuthorityRef {
  readonly keyId: string;
  readonly providerRef: string;
}

export interface InputManifest {
  readonly baseSha: string;
  readonly candidateShaOrDiff: string;
  readonly dependencyLockHash: string;
  readonly fixtureContentHashes: Readonly<Record<string, string>>;
  /** runtime/OS/tool versions */
  readonly toolchainIdentity: string;
  /** secrets excluded */
  readonly environmentConfig: Readonly<Record<string, string>>;
  readonly secretBackedAuthority?: readonly SecretBackedAuthorityRef[];
}

export interface ProofPackage {
  readonly candidateSha: string;
  readonly baseSha: string;
  readonly tree: string;
  readonly probeIdentities: readonly string[];
  readonly verifierAuthority: string;
  readonly provenInvariants: readonly string[];
  readonly inputManifest: InputManifest;
}

// ---------------------------------------------------------------------------------------------
// kind -> type mapping
// ---------------------------------------------------------------------------------------------

export interface PatternProofArtifactByKind {
  readonly discovery: DiscoveryArtifact;
  readonly 'dependency-graph': DependencyGraphArtifact;
  readonly 'decision-gate': DecisionGateArtifact;
  readonly 'red-plan': RedPlanArtifact;
  readonly candidate: CandidateArtifact;
  readonly 'pattern-verification': PatternVerificationArtifact;
  readonly 'input-manifest': InputManifest;
  readonly 'proof-package': ProofPackage;
}

/** Union of every protocol artifact (keyed by `PatternProofArtifactKind`). */
export type PatternProofArtifact = PatternProofArtifactByKind[PatternProofArtifactKind];
