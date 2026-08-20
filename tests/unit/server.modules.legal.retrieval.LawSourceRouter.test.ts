import { describe, expect, it } from 'vitest';
import {
  describeRoutingDecision,
  LAW_SOURCE_ROUTING_VERSION,
  routeLawQuery,
} from '../../server/modules/legal/retrieval/LawSourceRouter';
import { createRetrievalExecutionTrace } from '@miljobeslut/mps-retrieval-trace';

describe('LEGAL-RETRIEVAL-LAW-METADATA-ROUTING-01', () => {
  it('1. named statute -> correct source constraint', () => {
    const decision = routeLawQuery('Vad är miljöbalkens mål och tillämpningsområde?');
    expect(decision.source_constraint).toBe('regeringskansliet-sfs-1998-808');
    expect(decision.chapter_constraint).toBeNull();
    expect(decision.routing_version).toBe(LAW_SOURCE_ROUTING_VERSION);
  });

  it('1b. named statute via explicit SFS number (disambiguates two near-identically-titled sources)', () => {
    const decision898 = routeLawQuery('Förordning (1998:899) om miljöfarlig verksamhet och hälsoskydd');
    expect(decision898.source_constraint).toBe('regeringskansliet-sfs-1998-899');
    const decision338 = routeLawQuery('Förordning (2011:338) om miljöfarlig verksamhet och hälsoskydd (miljötillsyn)');
    expect(decision338.source_constraint).toBe('regeringskansliet-sfs-2011-338');
  });

  it('2. named statute + explicit chapter -> correct source AND chapter constraint', () => {
    const decision = routeLawQuery('enligt 7 kap. miljöbalken gäller följande hänsynsregler');
    expect(decision.source_constraint).toBe('regeringskansliet-sfs-1998-808');
    expect(decision.chapter_constraint).toBe('7');
  });

  it('2b. named statute + letter-suffixed chapter -> chapter constraint preserves the suffix', () => {
    const decision = routeLawQuery('vad säger 10 a kap. miljöbalken om detta?');
    expect(decision.source_constraint).toBe('regeringskansliet-sfs-1998-808');
    expect(decision.chapter_constraint).toBe('10 a');
  });

  it('3. no source signal -> NO fabricated constraint, not a guessed "probably Miljöbalken"', () => {
    const decision = routeLawQuery('Bestämmelser om avfall och avfallshantering');
    expect(decision.source_constraint).toBeNull();
    expect(decision.chapter_constraint).toBeNull();
    expect(decision.matched_signal).toBeNull();
  });

  it('3b. a bare chapter number with no named statute -> no constraint at all (chapter alone is meaningless)', () => {
    const decision = routeLawQuery('vad regleras i 7 kap.?');
    expect(decision.source_constraint).toBeNull();
    expect(decision.chapter_constraint).toBeNull();
  });

  it('3c. an ambiguous name shared by two sources, with no SFS number given -> no constraint (never guesses between them)', () => {
    const decision = routeLawQuery('Förordning om miljöfarlig verksamhet och hälsoskydd');
    expect(decision.source_constraint).toBeNull();
  });

  it('4. the retrieval trace records exactly which routing/filter decision was applied', () => {
    const decision = routeLawQuery('enligt 9 kap. miljöbalken');
    const routingLabel = describeRoutingDecision(decision);
    expect(routingLabel).toBe('law-source-routing-v1:source=regeringskansliet-sfs-1998-808,chapter=9');

    const trace = createRetrievalExecutionTrace({
      query_hash: 'q_hash_test',
      policy_version: 'legal-ret-policy-1',
      artifact_snapshot: 'snap_test',
      selected_artifact_refs: ['frag:example'],
      budget_profile: 'default',
      expansion_path: [routingLabel],
    });
    expect(trace.identity.expansion_path).toEqual([routingLabel]);

    const unroutedDecision = routeLawQuery('Bestämmelser om avfall och avfallshantering');
    const unroutedLabel = describeRoutingDecision(unroutedDecision);
    expect(unroutedLabel).toBe('law-source-routing-v1:no_constraint');
  });
});
