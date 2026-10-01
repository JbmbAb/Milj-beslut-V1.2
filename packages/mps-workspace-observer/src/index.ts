/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — observation layer.
 *
 * This package does read-only I/O against Git, the filesystem and the frozen corpus, and produces
 * an immutable WorkspaceSnapshotArtifact. It contains no policy: it may not import disposition or
 * policy types, and the boundary is enforced three ways — by package dependencies (this package's
 * package.json does not depend on the classifier), by an eslint rule, and by a transitive
 * import-graph test.
 *
 * Derived fields are permitted here only when their raw inputs are present in the same artifact.
 * The boundary is at policy LOADING, not at derivation.
 */
export {
  DOMAINS,
  canonicalBytes,
  framePreimage,
  framedDigest,
  framedDigestOfBytes,
  nonNfcPaths,
  sha256Hex,
  validatePayload,
} from './digest/CanonicalDigest.js';
export type { CanonicalDomain, PayloadViolation } from './digest/CanonicalDigest.js';

export {
  CommandSurface,
  CommandSurfaceDigestMismatch,
  RequestOutsideCommandSurface,
} from './surface/CommandSurface.js';
export type {
  CompositeOperation,
  CoverageReasonCode,
  FilesystemOperation,
  FilesystemRequest,
  FixedContainer,
  ProcessRequest,
  RequestFamily,
  RequestKind,
  RequestScope,
  SurfaceRequest,
} from './surface/CommandSurface.js';

export {
  caseIdFromComparisonKey,
  comparisonKey,
  isAbsolutePath,
  joinPath,
  parentOfGitDir,
  preferredSpelling,
  sortCandidateSpellings,
} from './surface/PathPolicy.js';
export type { CandidateSource, CandidateSpelling } from './surface/PathPolicy.js';

export type {
  BytesField,
  DirectoryEntry,
  FilesystemResponse,
  ProcessResponse,
  RequestPort,
  RequestTiming,
  TruncationInfo,
} from './port/RequestPort.js';

export {
  ObservationLedger,
  decodeUtf8,
} from './observe/ObservationLedger.js';
export type {
  LedgerEntry,
  NotAttemptedReason,
  ObservationState,
  UnknownReason,
} from './observe/ObservationLedger.js';

export {
  CommandSurfaceIncomplete,
  RequestSequencer,
  filesystemState,
  processState,
} from './observe/RequestSequencer.js';
export type { Candidate, SequencerOptions, SequencerResult } from './observe/RequestSequencer.js';

export {
  asCount,
  asSha,
  newestReflogEpochSeconds,
  parseGlobalRevParse,
  parseLocalHeads,
  parseLsRemoteSha,
  parseStashReflog,
  parseStatusPorcelainV2,
  parseWorkspaceRevParse,
  parseWorktreeList,
} from './observe/parsers.js';
export type {
  LocalHeadRef,
  RevParsePaths,
  StashEntry,
  StatusPorcelainV2,
  WorktreeListBlock,
} from './observe/parsers.js';

export { FilesystemPoolExhausted, LiveRequestPort, encodeBytes } from './port/LiveRequestPort.js';

export { correlate } from './observe/correlate.js';
export type { CorrelateOptions } from './observe/correlate.js';

export { observe } from './observe/WorkspaceObserver.js';
export type { ObservationResult, ObserveOptions } from './observe/WorkspaceObserver.js';

export {
  DIGEST_INCLUSION_TABLE,
  computeIdentityDigest,
  digestPayload,
} from './snapshot/SnapshotDigest.js';
export type { InclusionRow } from './snapshot/SnapshotDigest.js';

export {
  OBSERVER_VERSION,
  SNAPSHOT_SCHEMA_ID,
  SNAPSHOT_SCHEMA_VERSION,
} from './snapshot/types.js';
export type {
  AncestryFacts,
  BranchBindingClaim,
  CandidateSourceId,
  ContentEvidence,
  FilesystemClaim,
  GitMetadataClaim,
  GitWorktreeListClaim,
  GraphRelation,
  Observed,
  PositiveProof,
  RepositoryObservation,
  SnapshotMetadata,
  SpellingClaim,
  StashObservation,
  StatusFacts,
  WorkspaceObservation,
  WorkspaceSnapshotArtifact,
} from './snapshot/types.js';
