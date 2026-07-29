/**
 * Stable Mimers Brunn metrics contract (ADR-042).
 * Dashboard / OTel instrument names must not drift.
 */
export const MIMERS_METRICS = {
  casPutDuration: 'cas.put.duration',
  casGetDuration: 'cas.get.duration',
  casBytes: 'cas.bytes',
  casCacheHit: 'cas.cache.hit',
  casCacheMiss: 'cas.cache.miss',
  ledgerAppendDuration: 'ledger.append.duration',
  ledgerVerifyDuration: 'ledger.verify.duration',
  auditL0Duration: 'audit.l0.duration',
  auditL1Duration: 'audit.l1.duration',
  auditL2Duration: 'audit.l2.duration',
  auditL3Duration: 'audit.l3.duration',
} as const;

export type MimersMetricName = (typeof MIMERS_METRICS)[keyof typeof MIMERS_METRICS];
