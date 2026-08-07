import { CASBoundaryViolation, CAS_I04, CAS_I07, CAS_RUNTIME_AUTHORITY_VIOLATION } from './CASInvariants';

/** Namespaces runtime storage is allowed to own (CAS-I04). */
export const CAS_RUNTIME_NAMESPACES = ['runtime', 'snapshots', 'cache', 'temporary'] as const;
export type CASRuntimeNamespace = (typeof CAS_RUNTIME_NAMESPACES)[number];

/** Artifact kinds that carry Decision Authority and therefore can never live in runtime storage. */
export const CAS_AUTHORITY_ARTIFACT_TYPES = [
  'DecisionFacts',
  'EvidenceAuthority',
  'MaterializedTruth',
  'DecisionImpactArtifact',
  'EvidenceSetArtifact',
  'VerifiedEvidenceSet',
] as const;

/** Payload keys that smuggle authority into an otherwise innocent-looking runtime object. */
export const CAS_AUTHORITY_PAYLOAD_KEYS = [
  'decision_facts',
  'evidence_authority',
  'materialized_truth',
  'decision_impact',
  'evidence_set',
] as const;

const TYPE_KEYS = ['artifact_type', 'artifactType', 'kind', 'type', '__artifact'] as const;

function normalize(value: string): string {
  return value.replace(/[_\-\s]/g, '').toLowerCase();
}

const NORMALIZED_AUTHORITY_TYPES = new Set(CAS_AUTHORITY_ARTIFACT_TYPES.map(normalize));

/**
 * CAS-I04 / CAS-I07: runtime may hold derived, discardable state only.
 * Throws CAS_RUNTIME_AUTHORITY_VIOLATION when a payload represents Decision Authority.
 */
export function assertRuntimeStorable(payload: unknown): void {
  if (payload === null || typeof payload !== 'object') return;

  const record = payload as Record<string, unknown>;

  for (const key of TYPE_KEYS) {
    const declared = record[key];
    if (typeof declared === 'string' && NORMALIZED_AUTHORITY_TYPES.has(normalize(declared))) {
      throw new CASBoundaryViolation(
        CAS_RUNTIME_AUTHORITY_VIOLATION,
        CAS_I07,
        `runtime storage cannot hold authority artifact '${declared}'`,
      );
    }
  }

  for (const key of CAS_AUTHORITY_PAYLOAD_KEYS) {
    if (key in record) {
      throw new CASBoundaryViolation(
        CAS_RUNTIME_AUTHORITY_VIOLATION,
        CAS_I07,
        `runtime payload contains authority field '${key}'`,
      );
    }
  }
}

export function assertRuntimeNamespace(namespace: string): asserts namespace is CASRuntimeNamespace {
  if ((CAS_RUNTIME_NAMESPACES as readonly string[]).includes(namespace)) return;
  throw new CASBoundaryViolation(
    CAS_RUNTIME_AUTHORITY_VIOLATION,
    CAS_I04,
    `namespace '${namespace}' is outside runtime storage (allowed: ${CAS_RUNTIME_NAMESPACES.join(', ')})`,
  );
}

export interface CASRuntimeHandle {
  readonly namespace: CASRuntimeNamespace;
  readonly key: string;
}

/**
 * Guard placed between the runtime layer and any storage it uses. It is deliberately not a flag on
 * the CAS repository: runtime acceleration and decision authority are separate boundaries.
 */
export class CASRuntimeBoundary {
  private readonly entries = new Map<string, unknown>();
  readonly namespace: CASRuntimeNamespace;

  constructor(namespace: string = 'runtime') {
    assertRuntimeNamespace(namespace);
    this.namespace = namespace;
  }

  store(payload: unknown, key: string = `entry-${this.entries.size}`): CASRuntimeHandle {
    assertRuntimeStorable(payload);
    this.entries.set(key, payload);
    return { namespace: this.namespace, key };
  }

  /** Alias for call sites written as `runtime.save(...)`. Same guard, same violation code. */
  save(payload: unknown, key?: string): CASRuntimeHandle {
    return this.store(payload, key);
  }

  read(key: string): unknown {
    return this.entries.get(key) ?? null;
  }

  /** Runtime state is discardable by definition (CAS-I04). */
  discard(): void {
    this.entries.clear();
  }
}
