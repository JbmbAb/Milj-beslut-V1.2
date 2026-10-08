export {
  PORT_MODULE_PATH,
  REGISTRATION_IDENTIFIER,
  StaticCensusAccumulator,
  computeStaticCensus,
  isCodePath,
  isDocumentationPath,
  isTestPath,
  nonliteralDynamicImportSites,
  VENDORED_DYNAMIC_IMPORT_EXCEPTIONS,
  vendoredExceptionFor,
  type VendoredException,
  type DynamicImportSite,
  type ExemptDynamicImportSite,
  type StaticCensus,
  type StaticCensusDetail,
  type TreeEntry,
} from './staticCensus.js';
export {
  LaunchSurfaceObserver,
  assessEntrypointDerivability,
  deriveEntrypointSet,
  type EntrypointDerivability,
  type DerivedEntrypointSet,
  type ObservedLaunchSurfaces,
} from './entrypointSet.js';
export { iterateTreeEntries, resolveSubject, type Subject } from './gitTree.js';
export { sealBootObservations, type ProbeObservation, type SealInput, type SealResult, type SealedEntrypoint } from './bootProbe/seal.js';
export { runBootProbe, type BootAttempt, type BootProbeRun, type RunBootProbeOptions } from './bootProbe/harness.js';
export { productionStartupGateSeen } from './bootProbe/productionGates.js';
export { assertExactCheckout, blobIdAt, type ExactCheckout } from './bootProbe/exactCheckout.js';
