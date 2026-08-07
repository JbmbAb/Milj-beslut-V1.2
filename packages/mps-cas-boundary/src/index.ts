/**
 * @miljobeslut/mps-cas-boundary
 * CAS as identity and authority boundary (Commit H.1 contract freeze, H.2 physical boundary).
 * See docs/architecture/ADR-MPS-CAS-STORAGE-BOUNDARY.md
 */

export {
  CASBoundaryViolation,
  CAS_BOUNDARY_CONTRACT_VERSION,
  CAS_DIGEST_MISMATCH,
  CAS_I02,
  CAS_I03,
  CAS_I04,
  CAS_I05,
  CAS_I06,
  CAS_I07,
  CAS_IMMUTABILITY_VIOLATION,
  CAS_INVALID_HASH,
  CAS_MUTATION_FORBIDDEN,
  CAS_REVERSE_IDENTITY_FORBIDDEN,
  CAS_RUNTIME_AUTHORITY_VIOLATION,
  type CASInvariantId,
  type CASViolationCode,
} from './CASInvariants';

export {
  deriveIdentityFromPath,
  joinCASRoot,
  parseCASHash,
  readDigestFromCASPath,
  resolveObjectPath,
  type CASAlgorithm,
  type CASHashRef,
  type CASObjectLocation,
} from './CASPathResolver';

export {
  assertCASOperationAllowed,
  digestBytes,
  sealCASRepository,
  InMemoryCASRepository,
  CAS_ALLOWED_OPERATIONS,
  CAS_FORBIDDEN_OPERATIONS,
  type CASAllowedOperation,
  type CASPutResult,
  type WriteOnceCASRepository,
} from './CASWriteOnceRepository';

export {
  assertRuntimeNamespace,
  assertRuntimeStorable,
  CASRuntimeBoundary,
  CAS_AUTHORITY_ARTIFACT_TYPES,
  CAS_AUTHORITY_PAYLOAD_KEYS,
  CAS_RUNTIME_NAMESPACES,
  type CASRuntimeHandle,
  type CASRuntimeNamespace,
} from './CASRuntimeBoundary';
