/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — classification layer.
 *
 * `classify(snapshot, operation) -> disposition` is a pure function: no disk, no network, no Git,
 * no clock. It never receives the frozen expectations, and the package has no dependency that could
 * give it any of those.
 *
 * The observer package must never import from here. That direction is forbidden by an eslint rule,
 * by the observer's package manifest, and by a transitive import-graph test, because the earliest
 * symptom of the boundary eroding is an observer that quietly applies policy.
 */
export { classify, DEFAULT_POLICY } from './classify.js';
export type {
  ClassifiableObserved,
  ClassifiableSnapshot,
  ClassifiableWorkspace,
  ClassifierPolicy,
} from './classify.js';

export {
  CANDIDATE_SHAPES,
  CONFLICT_TABLE,
  CONFLICT_TABLE_CELL_COUNT,
  DEFAULT_ARM,
  METADATA_CLAIMS,
  WORKSPACE_VIEWS,
  conflictKey,
  renderConflictTable,
  resolveConflict,
} from './ConflictTable.js';
export type {
  CandidateShape,
  ConflictBlockerCode,
  ConflictKey,
  ConflictOutcome,
  MetadataClaim,
  WorkspaceView,
} from './ConflictTable.js';

export { CLASSIFIER_VERSION, POLICY_VERSION } from './types.js';
export type {
  BlockerCode,
  ClassificationResult,
  Decision,
  Disposition,
  OperationScope,
  ResolvableBy,
  WorkspaceBlocker,
  WorkspaceFinding,
} from './types.js';

export { effectiveSeverity } from './reporting.js';
export type { EffectiveSeverity } from './reporting.js';
