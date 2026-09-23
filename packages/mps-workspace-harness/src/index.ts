/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — test harness.
 *
 * The harness is the ONLY component that reads the frozen expectations. Neither the Observer nor
 * the Classifier ever receives them: the Classifier is blind to the facit by construction, which is
 * what makes a passing comparison mean something.
 *
 * Local runs of this harness are diagnostic and create no verification authority. The authoritative
 * acceptance run executes outside the implementer's write domain, fetches the corpus and the
 * expectations by content hash, and prints the eight authority digests it actually used.
 */
export {
  AuthorityDigestMismatch,
  REQUIRED_BINDINGS,
  bindAuthority,
} from './AuthorityBinding.js';
export type { AuthorityReference, BoundAuthority, RequiredBindingName } from './AuthorityBinding.js';

export {
  CorpusAuthorityMismatch,
  NotCapturedByPrecondition,
  NotInCorpus,
  ReplayTransport,
  fsKey,
  globalIdentityDigest,
  loadCorpus,
  processKey,
} from './ReplayTransport.js';
export type { LoadedCorpus } from './ReplayTransport.js';

export { renderAcceptanceReport, runReplayAcceptance } from './AcceptanceRunner.js';
export type {
  AcceptanceOptions,
  AcceptanceReport,
  CaseOutcome,
  CaseResult,
  FrozenExpectation,
} from './AcceptanceRunner.js';
