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
