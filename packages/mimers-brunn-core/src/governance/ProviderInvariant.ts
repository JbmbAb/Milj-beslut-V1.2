/**

 * Frozen Master Archive provider tree + move invariant.

 *

 * New provider folders must be registered here (and in IMPORT_REGISTRY)

 * before harvest agents may write under Data/<Provider>/.

 *

 * Invariant: a file must never change provider without an explicit

 * SAN-/Migration-event (see SanitationArtifact action MOVE + reason provider_mismatch).

 */



export const PROVIDER_CHANGE_REQUIRES_SAN = true as const;

/** After sanitation waves: no ad-hoc manual moves — classifier + SAN only. */
export const MASTER_ARCHIVE_MANUAL_MOVES_FROZEN = true as const;



/** Canonical Data/<Provider>/ roots allowed in GEO_Master_Archive. */

export const ARCHIVE_PROVIDERS = [

  'Lantmateriet',

  'LM',

  'Trafikverket',

  'SGU',

  'SMHI',

  'MSB',

  'Naturvardsverket',

  'Skogsstyrelsen',

  'VISS',

  'MCF',

  'LST',

  'RAA',

  'SMED',

  'MPD',

  'MMD',

  'Miljolut',

  'Miljobeslut_Ops',

  'Gbg_Luftkvalitet',

] as const;



export type ArchiveProvider = (typeof ARCHIVE_PROVIDERS)[number];



/** Product categories under Data/Trafikverket/ (frozen). */

export const TRAFIKVERKET_CATEGORIES = [

  'Mätdata',

  'Beläggning',

  'Avvattning',

  'Buller',

] as const;



export type TrafikverketCategory = (typeof TRAFIKVERKET_CATEGORIES)[number];



const PROVIDER_SET = new Set<string>(ARCHIVE_PROVIDERS.map((p) => p.toLowerCase()));



export function isArchiveProvider(name: string): name is ArchiveProvider {

  return PROVIDER_SET.has(name.trim().toLowerCase());

}



export function assertArchiveProvider(name: string): asserts name is ArchiveProvider {

  if (!isArchiveProvider(name)) {

    throw new Error(

      `Unknown archive provider "${name}". Register in ARCHIVE_PROVIDERS + IMPORT_REGISTRY before writing Data/${name}/.`,

    );

  }

}



export function assertProviderChangeHasSan(operationId: string | undefined | null): void {

  if (!PROVIDER_CHANGE_REQUIRES_SAN) return;

  if (!operationId || !/^SAN-\d{4}-\d+/i.test(operationId)) {

    throw new Error(

      'Provider change requires explicit SAN-/Migration-event (operation_id like SAN-YYYY-NNN).',

    );

  }

}


