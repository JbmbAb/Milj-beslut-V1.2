import type { PropertyLookupInput } from './types';

/**
 * Enar kroppar från UI (propertyDesignation + purpose), geo.client (designation) och framtida klienter.
 */
export function normalizePropertyLookupBody(body: unknown): PropertyLookupInput {
  if (!body || typeof body !== 'object') {
    throw new Error('Ogiltig begäran: body saknas');
  }
  const b = body as Record<string, unknown>;
  const rawDesig = b.propertyDesignation ?? b.designation;
  const propertyDesignation = typeof rawDesig === 'string' ? rawDesig.trim() : '';
  const projectId = typeof b.projectId === 'string' ? b.projectId.trim() : '';
  const rawPurpose = b.purpose;
  const purpose = typeof rawPurpose === 'string' && rawPurpose.trim() ? rawPurpose.trim() : 'API_LOOKUP';
  return { projectId, propertyDesignation, purpose };
}

/**
 * Lantmateriet visar ibland delomraden som "3:12 (2)", medan OGC-faltet etikett
 * anvander suffixformen "3:12>2". Normalisera endast ett avslutande parentes-suffix.
 */
export function normalizeLantmaterietDesignationNotation(propertyDesignation: string): string {
  return String(propertyDesignation || '')
    .replace(/\s+\((\d+)\)\s*$/, '>$1')
    .trim();
}
