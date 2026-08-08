/**

 * ClassifierArtifact — immutable classification receipt before any relocation.

 *

 * Pipeline: Inventory → Fingerprint → Classifier → Confidence → Decision

 * A path must not change provider/location without a ClassifierArtifact

 * (and for provider changes, also a SAN MOVE event).

 */



export const CLASSIFIER_SCHEMA_VERSION = '1.0' as const;



export type ClassifierAction = 'AUTO_MOVE' | 'HITL_REVIEW' | 'QUARANTINE_REVIEW';



export type ClassifierConfidenceBand = 'high' | 'medium' | 'low';



export type PathFingerprint = {

  readonly abs_path: string;

  readonly rel_path: string;

  readonly basename: string;

  readonly parent_dirs: readonly string[];

  readonly is_directory: boolean;

  readonly file_count: number;

  readonly total_bytes: number;

  readonly ext_histogram: Readonly<Record<string, number>>;

  readonly sample_names: readonly string[];

  readonly mime_hints: readonly string[];

  readonly manifest_signals: Readonly<Record<string, unknown>> | null;

  readonly url_signals: readonly string[];

};



export type ClassifierArtifact = {

  readonly schema_version: typeof CLASSIFIER_SCHEMA_VERSION;

  readonly artifact_type: 'CLASSIFIER';

  readonly artifact_id: string;

  readonly input_path: string;

  readonly fingerprint: PathFingerprint;

  readonly predicted_provider: string | null;

  readonly predicted_dataset: string | null;

  readonly predicted_target: string | null;

  readonly confidence: number;

  readonly confidence_band: ClassifierConfidenceBand;

  readonly reasoning: string;

  readonly matched_patterns: readonly string[];

  readonly action: ClassifierAction;

  readonly created_at: string;

  readonly classifier_id: string;

  readonly related_operation_ids?: readonly string[];

};



export type BuildClassifierArtifactInput = {

  artifact_id: string;

  input_path: string;

  fingerprint: PathFingerprint;

  predicted_provider: string | null;

  predicted_dataset: string | null;

  predicted_target: string | null;

  confidence: number;

  reasoning: string;

  matched_patterns: readonly string[];

  action: ClassifierAction;

  classifier_id?: string;

  created_at?: string;

  related_operation_ids?: readonly string[];

};



export const CLASSIFIER_THRESHOLDS = {

  /** confidence > high → AUTO_MOVE */

  high: 0.98,

  /** confidence >= medium and <= high → HITL_REVIEW */

  medium: 0.75,

} as const;



export function confidenceBand(confidence: number): ClassifierConfidenceBand {

  if (confidence > CLASSIFIER_THRESHOLDS.high) return 'high';

  if (confidence >= CLASSIFIER_THRESHOLDS.medium) return 'medium';

  return 'low';

}



export function actionForConfidence(confidence: number): ClassifierAction {

  const band = confidenceBand(confidence);

  switch (band) {

    case 'high':

      return 'AUTO_MOVE';

    case 'medium':

      return 'HITL_REVIEW';

    case 'low':

      return 'QUARANTINE_REVIEW';

    default: {

      const _exhaustive: never = band;

      return _exhaustive;

    }

  }

}



export function buildClassifierArtifact(input: BuildClassifierArtifactInput): ClassifierArtifact {

  const confidence = Math.max(0, Math.min(1, input.confidence));

  return {

    schema_version: CLASSIFIER_SCHEMA_VERSION,

    artifact_type: 'CLASSIFIER',

    artifact_id: input.artifact_id,

    input_path: input.input_path,

    fingerprint: input.fingerprint,

    predicted_provider: input.predicted_provider,

    predicted_dataset: input.predicted_dataset,

    predicted_target: input.predicted_target,

    confidence,

    confidence_band: confidenceBand(confidence),

    reasoning: input.reasoning,

    matched_patterns: input.matched_patterns,

    action: input.action,

    created_at: input.created_at ?? new Date().toISOString(),

    classifier_id: input.classifier_id ?? 'mimer.classifier.v1',

    related_operation_ids: input.related_operation_ids,

  };

}



export function assertClassifierArtifact(value: unknown): asserts value is ClassifierArtifact {

  if (!value || typeof value !== 'object') throw new Error('ClassifierArtifact must be an object');

  const v = value as Record<string, unknown>;

  if (v.schema_version !== CLASSIFIER_SCHEMA_VERSION) {

    throw new Error(`Unsupported classifier schema_version: ${String(v.schema_version)}`);

  }

  if (v.artifact_type !== 'CLASSIFIER') throw new Error('artifact_type must be CLASSIFIER');

  if (typeof v.artifact_id !== 'string' || !v.artifact_id) throw new Error('artifact_id required');

  if (typeof v.input_path !== 'string' || !v.input_path) throw new Error('input_path required');

  if (typeof v.confidence !== 'number') throw new Error('confidence required');

  if (typeof v.action !== 'string') throw new Error('action required');

}


