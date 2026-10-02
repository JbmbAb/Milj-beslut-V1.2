/**
 * DEMO-ONLY (branch demo/lu-demonstrator-72h, never for main).
 *
 * The local demo runs the four LU workers against a shared PostGIS database that already holds
 * queue rows from earlier governed runs (e.g. a PENDING execution-identity request from
 * 2026-09-28). Owner decision A forbids UPDATE on existing data, so every LU queue claim is
 * restricted to rows created at/after LU_DEMO_QUEUE_CLAIM_NOT_BEFORE when that env var is set.
 * Unset => upstream behaviour (no extra filter).
 */
export function demoQueueClaimFloorWhere(): { createdAt?: { gte: Date } } {
  const raw = process.env.LU_DEMO_QUEUE_CLAIM_NOT_BEFORE?.trim();
  if (!raw) return {};
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new Error('LU_DEMO_QUEUE_CLAIM_NOT_BEFORE must be ISO-8601');
  }
  return { createdAt: { gte: new Date(parsed) } };
}
