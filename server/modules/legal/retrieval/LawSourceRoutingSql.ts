/**
 * LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-ROUTING-01.
 *
 * Translates a RoutingDecision (pure text-only, see LawSourceRouter.ts) into a SQL WHERE
 * fragment admitting a chunk if it belongs to ANY of the routed source candidates, respecting
 * each candidate's own (optional) chapter constraint independently:
 *
 *   (source = A AND chapter = 'x') OR (source = B) OR (source = C AND chapter = 'y')
 *
 * Kept separate from LawSourceRouter.ts deliberately: the router stays pure/DB-agnostic (text in,
 * decision out), SQL construction is a server-side concern.
 */
import type { RoutingDecision } from './LawSourceRouter';

export interface CandidateWhereClause {
  /** Empty string when there are no candidates (no constraint) -- caller should omit entirely. */
  readonly sql: string;
  readonly params: readonly unknown[];
}

export function buildCandidateWhereClause(decision: RoutingDecision, paramOffset: number): CandidateWhereClause {
  if (decision.source_candidates.length === 0) {
    return { sql: '', params: [] };
  }
  const params: unknown[] = [];
  const clauses = decision.source_candidates.map((candidate) => {
    params.push(candidate.logicalSourceId);
    const sourceParamIndex = paramOffset + params.length;
    if (candidate.chapter_constraint) {
      params.push(candidate.chapter_constraint);
      const chapterParamIndex = paramOffset + params.length;
      return `(m.logical_source_id = $${sourceParamIndex} AND lower(c.chapter) = $${chapterParamIndex})`;
    }
    return `(m.logical_source_id = $${sourceParamIndex})`;
  });
  return { sql: `AND (${clauses.join(' OR ')})`, params };
}
