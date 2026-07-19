/**
 * bulkGuard.ts
 *
 * Hård skiljelinje: Bulk/ETL-källor ska inte kunna användas i runtime-flöden
 * som implicit fallback.
 */

const BULK_MARKERS = ['stac', 'geotorget', 'download-opendata', 'atom'];
import { inc } from '../observability/metrics';

export function assertRuntimeUrlNotBulk(url: string, context: string): void {
  const u = String(url || '').toLowerCase();
  const hit = BULK_MARKERS.find((m) => u.includes(m));
  if (hit) {
    inc('runtime.bulk_guard.denied', 1);
    throw new Error(`RUNTIME_BULK_FORBIDDEN: bulk marker "${hit}" in runtime url (${context})`);
  }
}
