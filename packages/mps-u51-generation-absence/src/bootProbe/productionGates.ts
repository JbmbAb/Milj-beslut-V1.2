/**
 * Recognition of each derived entry's own refusal text.
 *
 * The set of processes comes from composition derivation. This table does not choose roots. It only
 * recognises the refusal already written in those sources, so a crash earlier than that refusal
 * cannot be reported as a completed boot. An id with no recognised gate fails closed.
 */

const WORKER_REFUSAL = 'is not set -- refusing to start.';
const WEB_REFUSAL = 'Missing required security env variables';

const WORKER_IDS = [
  'lu-execution-identity-v3',
  'lu-geometry-supersession',
  'lu-project-context-bootstrap',
  'lu-viewer-capability',
] as const;

export function productionStartupGateSeen(entryId: string, text: string): boolean {
  if (entryId === 'web') return text.includes(WEB_REFUSAL);
  if ((WORKER_IDS as readonly string[]).includes(entryId)) return text.includes(WORKER_REFUSAL);
  return false;
}
