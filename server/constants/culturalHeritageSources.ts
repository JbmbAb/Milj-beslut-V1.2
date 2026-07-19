/**
 * Officiella referenser för kulturarvsdata (RAA K-samsök) och öppen datakatalog.
 * K-samsök är sök-API för kulturarvsdata.se — kompletterar WMS/WFS Fornsök i kartan.
 */

/** RAA: Kom igång med K-samsöks API (URI, objekt vs API, JSON-LD, boundingBox m.m.) */
export const RAA_KSAMSOK_API_GUIDE_URL =
  'https://www.raa.se/hitta-information/k-samsok/att-anvanda-k-samsok/kom-igang-med-k-samsoks-api/';

/** Bas-URL för K-samsöks webb-API (sökning, getRelations, …) */
export const KSAMSOK_API_BASE_URL = String(
  process.env.KSAMSOK_API_BASE_URL || 'https://kulturarvsdata.se/ksamsok/api',
).replace(/\/$/, '');

/** Sveriges dataportal – dataset-sök (DCAT); använd somstart vid tematisk nedladdning */
export const DATAPORTAL_DATASETS_BASE_URL = 'https://dataportal.se/sv/datasets';

export function buildDataportalDatasetSearchUrl(searchQuery: string): string {
  const q = searchQuery.trim() || 'kulturarv miljö';
  const url = new URL(DATAPORTAL_DATASETS_BASE_URL);
  url.searchParams.set('search', q);
  return url.toString();
}
