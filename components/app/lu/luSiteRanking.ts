/**
 * W-UI1 (B; U20CDF4 beslut 4, owner doctrine 2026-10-03) -- the consumer of generate-report's
 * `summary.not_ranked_site_ids`. A site there HAS a governed assessment but is outside the ranking population
 * (a withheld permit probability, SEM-1, or a record whose integrity is not established): it is never ranked
 * and can never be the best alternative, and the UI says why. `unassessed_site_ids` is read only as the
 * compatibility field it is -- "no governed assessment" -- and only when `not_ranked_site_ids` is absent.
 * A contradictory answer (a site both ranked and not ranked, or a "best" site that is not ranked) is never
 * ranked and never best. Pure.
 */

export type LuSiteRankingState = 'RANKED' | 'NOT_RANKED' | 'UNASSESSED' | 'UNKNOWN';

export interface LuSiteRankingView {
  readonly state: LuSiteRankingState;
  /** The Swedish line for a site that is not ranked; null when nothing needs saying. */
  readonly textSv: string | null;
  /** True only for a ranked site that the server names as the best alternative. */
  readonly mayBeBest: boolean;
}

const NOT_RANKED_PREFIX = 'Platsen rangordnas inte och kan inte vara bästa alternativ';

/** Why a site with a governed assessment is not ranked, by the run's assessment_status. */
const NOT_RANKED_REASON_SV: Readonly<Record<string, string>> = {
  RECORD_INTEGRITY_ERROR: 'postens integritet kan inte intygas',
  ASSESSED: 'bedömningen kan inte jämföras med andra platser eftersom minst en kontroll inte kunde genomföras',
};

function ownList(value: unknown, key: string): string[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  const list = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : null;
}

function ownString(value: unknown, key: string): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && typeof descriptor.value === 'string' ? descriptor.value : null;
}

const UNKNOWN: LuSiteRankingView = { state: 'UNKNOWN', textSv: null, mayBeBest: false };

export function presentLuSiteRanking(summary: unknown, siteId: string, assessmentStatus: unknown): LuSiteRankingView {
  try {
    const assessed = ownList(summary, 'assessed_site_ids') ?? [];
    const notRanked = ownList(summary, 'not_ranked_site_ids');
    const unassessed = ownList(summary, 'unassessed_site_ids');
    const best = ownString(summary, 'bestAlternativeId');
    // Not ranked wins over everything else the answer says about the site (also "assessed" or "best").
    if (notRanked !== null && notRanked.includes(siteId)) {
      const reason =
        typeof assessmentStatus === 'string' && Object.prototype.hasOwnProperty.call(NOT_RANKED_REASON_SV, assessmentStatus)
          ? NOT_RANKED_REASON_SV[assessmentStatus]
          : null;
      return { state: 'NOT_RANKED', textSv: reason ? `${NOT_RANKED_PREFIX}: ${reason}.` : `${NOT_RANKED_PREFIX}.`, mayBeBest: false };
    }
    if (assessed.includes(siteId)) return { state: 'RANKED', textSv: null, mayBeBest: best === siteId };
    if (unassessed !== null && unassessed.includes(siteId)) {
      // Compatibility only: an older server listed assessed-but-unranked sites here too, so "no governed
      // assessment" is said only when the run itself has none.
      if (assessmentStatus === 'ASSESSED' || assessmentStatus === 'RECORD_INTEGRITY_ERROR') return UNKNOWN;
      return { state: 'UNASSESSED', textSv: 'Platsen har ingen styrd bedömning och ingår inte i jämförelsen.', mayBeBest: false };
    }
    return UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}
