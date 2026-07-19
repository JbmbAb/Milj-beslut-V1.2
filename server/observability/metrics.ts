/**
 * In-process metrics registry.
 *
 * Used for migration observability: fallback usage, source distribution,
 * and denied mutations (LOCKED violations).
 */

type CounterKey =
  | 'property_lookup.source.postgis'
  | 'property_lookup.source.open_ogc'
  | 'property_lookup.source.oauth'
  | 'requirements.denied.locked'
  | 'citations.denied.locked'
  | 'cases.denied.locked'
  | 'evidence.snapshot.created'
  | 'evidence.snapshot.created.locked'
  | 'evidence.snapshot.created.from_submission'
  | 'evidence.export.created'
  | 'evidence.export.created.from_locked_snapshot'
  | 'evidence.export.created.from_unlocked_snapshot'
  | 'evidence.governance.system_override_with_prior_export'
  | 'runtime.bulk_guard.denied';

const counters: Record<CounterKey, number> = {
  'property_lookup.source.postgis': 0,
  'property_lookup.source.open_ogc': 0,
  'property_lookup.source.oauth': 0,
  'requirements.denied.locked': 0,
  'citations.denied.locked': 0,
  'cases.denied.locked': 0,
  'evidence.snapshot.created': 0,
  'evidence.snapshot.created.locked': 0,
  'evidence.snapshot.created.from_submission': 0,
  'evidence.export.created': 0,
  'evidence.export.created.from_locked_snapshot': 0,
  'evidence.export.created.from_unlocked_snapshot': 0,
  'evidence.governance.system_override_with_prior_export': 0,
  'runtime.bulk_guard.denied': 0,
};

export function inc(key: CounterKey, n: number = 1): void {
  counters[key] = (counters[key] ?? 0) + n;
}

export function snapshotMetrics(): Record<string, number> {
  return { ...counters };
}
