import { describe, expect, it } from 'vitest';
import {
  describeRoutingDecision,
  LAW_SOURCE_ROUTING_VERSION,
  routeLawQuery,
} from '../../server/modules/legal/retrieval/LawSourceRouter';
import { createRetrievalExecutionTrace } from '@miljobeslut/mps-retrieval-trace';

describe('LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-ROUTING-01', () => {
  it('single statute -> existing v1 behavior unchanged (one candidate, no chapter)', () => {
    const decision = routeLawQuery('Vad är miljöbalkens mål och tillämpningsområde?');
    expect(decision.source_candidates).toHaveLength(1);
    expect(decision.source_candidates[0]).toMatchObject({
      logicalSourceId: 'regeringskansliet-sfs-1998-808',
      chapter_constraint: null,
    });
    expect(decision.routing_version).toBe(LAW_SOURCE_ROUTING_VERSION);
  });

  it('single statute + chapter -> existing perfect holdout behavior preserved (one candidate, chapter bound)', () => {
    const decision = routeLawQuery('enligt 7 kap. miljöbalken gäller följande hänsynsregler');
    expect(decision.source_candidates).toHaveLength(1);
    expect(decision.source_candidates[0]).toMatchObject({
      logicalSourceId: 'regeringskansliet-sfs-1998-808',
      chapter_constraint: '7',
    });
  });

  it('single statute via explicit SFS number still disambiguates the two near-identically-titled sources', () => {
    const d898 = routeLawQuery('Förordning (1998:899) om miljöfarlig verksamhet och hälsoskydd');
    expect(d898.source_candidates.map((c) => c.logicalSourceId)).toEqual(['regeringskansliet-sfs-1998-899']);
    const d338 = routeLawQuery('Förordning (2011:338) om miljöfarlig verksamhet och hälsoskydd (miljötillsyn)');
    expect(d338.source_candidates.map((c) => c.logicalSourceId)).toEqual(['regeringskansliet-sfs-2011-338']);
  });

  it('two statutes -> both admitted as candidates, never first-match-wins', () => {
    const decision = routeLawQuery('Vad gäller enligt både miljöprövningsförordningen och miljöbalken för tillståndsprövning av djurhållning?');
    const ids = decision.source_candidates.map((c) => c.logicalSourceId).sort();
    expect(ids).toEqual(['regeringskansliet-sfs-1998-808', 'regeringskansliet-sfs-2013-251'].sort());
  });

  it('H21 (the real holdout regression): correct source is no longer excluded', () => {
    // Under v1, this query wrongly excluded regeringskansliet-sfs-2013-251 (the source that
    // actually held the correct answer in LEGAL-RETRIEVAL-LAW-METADATA-HOLDOUT-01) because
    // miljöbalken matched first. v2 must admit both.
    const decision = routeLawQuery('Vad gäller enligt både miljöprövningsförordningen och miljöbalken för tillståndsprövning av djurhållning?');
    const ids = decision.source_candidates.map((c) => c.logicalSourceId);
    expect(ids).toContain('regeringskansliet-sfs-2013-251');
    expect(ids).toContain('regeringskansliet-sfs-1998-808');
  });

  it('chapter binds only to the source it is textually adjacent to, not to every matched source ("9 kap. miljöbalken och miljöprövningsförordningen")', () => {
    const decision = routeLawQuery('9 kap. miljöbalken och miljöprövningsförordningen');
    const mb = decision.source_candidates.find((c) => c.logicalSourceId === 'regeringskansliet-sfs-1998-808');
    const mpf = decision.source_candidates.find((c) => c.logicalSourceId === 'regeringskansliet-sfs-2013-251');
    expect(mb?.chapter_constraint).toBe('9');
    expect(mpf?.chapter_constraint).toBeNull();
  });

  it('two independently chaptered statutes each get their own chapter binding ("avfallsförordningens 2 kap. till miljöbalkens bestämmelser i 2 kap.")', () => {
    const decision = routeLawQuery('avfallsförordningens 2 kap. till miljöbalkens bestämmelser i 2 kap.');
    const avf = decision.source_candidates.find((c) => c.logicalSourceId === 'regeringskansliet-sfs-2020-614');
    expect(avf?.chapter_constraint).toBe('2');
  });

  it('three statutes -> all recognized sources admitted deterministically, in query order', () => {
    const decision = routeLawQuery(
      'Jämför miljöbalken, avfallsförordningen och plan- och bygglagen när det gäller tillsyn.',
    );
    expect(decision.source_candidates.map((c) => c.logicalSourceId)).toEqual([
      'regeringskansliet-sfs-1998-808',
      'regeringskansliet-sfs-2020-614',
      'regeringskansliet-sfs-2010-900',
    ]);
  });

  it('unknown/generic statute wording -> no fabricated source, even with a chapter present', () => {
    const decision = routeLawQuery('Bestämmelser om avfall och avfallshantering');
    expect(decision.source_candidates).toHaveLength(0);
    const withChapter = routeLawQuery('vad regleras i 7 kap.?');
    expect(withChapter.source_candidates).toHaveLength(0);
  });

  it('a name shared by two sources, with no SFS number given, is never guessed (stays unrecognized, not a fabricated candidate)', () => {
    const decision = routeLawQuery('Förordning om miljöfarlig verksamhet och hälsoskydd');
    expect(decision.source_candidates).toHaveLength(0);
  });

  it('ambiguous_by_design stays no_constraint, unchanged from v1', () => {
    const decision = routeLawQuery('Vad säger bestämmelserna om hälsoskydd?');
    expect(decision.source_candidates).toHaveLength(0);
    expect(describeRoutingDecision(decision)).toBe('law-source-routing-v2:no_constraint');
  });

  it('the retrieval trace records the exact source candidate set and per-source chapter constraint', () => {
    const decision = routeLawQuery('9 kap. miljöbalken och miljöprövningsförordningen');
    const routingLabel = describeRoutingDecision(decision);
    expect(routingLabel).toBe(
      'law-source-routing-v2:sources=regeringskansliet-sfs-1998-808[ch.9]+regeringskansliet-sfs-2013-251[any]',
    );

    const trace = createRetrievalExecutionTrace({
      query_hash: 'q_hash_test',
      policy_version: 'legal-ret-policy-1',
      artifact_snapshot: 'snap_test',
      selected_artifact_refs: ['frag:example'],
      budget_profile: 'default',
      expansion_path: [routingLabel],
    });
    expect(trace.identity.expansion_path).toEqual([routingLabel]);
  });
});
