export { KNOWLEDGE_EVAL_REPORT_SCHEMA, KNOWLEDGE_EVAL_VERSION } from './versions';
export {
  GoldenCaseError,
  goldSetHash,
  validateGoldenCases,
  type ChunkPredicate,
  type GoldenCase,
  type GoldenCategory,
  type GoldenExpectation,
} from './GoldenCase';
export { hitAtK, mean, ndcgAtK, recallAtK, reciprocalRank, round4 } from './Metrics';
export {
  computeCoverage,
  DEFAULT_EVAL_CONFIG,
  filtersForMode,
  judgeAcceptance,
  runGoldenEval,
  type AcceptanceVerdict,
  type CaseResult,
  type CoverageMetrics,
  type EvalConfig,
  type EvalHit,
  type EvalMetrics,
  type EvalMode,
  type EvalReport,
  type RunGoldenEvalArgs,
} from './Harness';
export { writeEvalReport } from './ReportWriter';
export {
  calibrateAbstentionThreshold,
  DEFAULT_CALIBRATION_QUERIES,
  type AbstentionCalibration,
} from './AbstentionCalibration';
