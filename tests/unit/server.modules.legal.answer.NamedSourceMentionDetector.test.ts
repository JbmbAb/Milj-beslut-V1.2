import { describe, expect, it } from 'vitest';
import { findUnrecognizedStatuteMentions } from '../../server/modules/legal/answer/NamedSourceMentionDetector';

describe('LEGAL-ANSWER-NAMED-SOURCE-CONSISTENCY-GATE-01 -- NamedSourceMentionDetector', () => {
  it('"fiskelagen" is flagged as an unrecognized statute mention', () => {
    const mentions = findUnrecognizedStatuteMentions('Vilka regler gäller för fiske och fiskevård enligt fiskelagen?');
    expect(mentions).toContain('fiskelagen');
  });

  it('"inkomstskattelagen" is flagged (a real, but uncovered, statute)', () => {
    const mentions = findUnrecognizedStatuteMentions('Vilka skatteregler gäller för aktiebolag enligt inkomstskattelagen?');
    expect(mentions).toContain('inkomstskattelagen');
  });

  it('"miljöbalken" (a known, recognized source) is NOT flagged as unrecognized', () => {
    const mentions = findUnrecognizedStatuteMentions('Vad är miljöbalkens mål och tillämpningsområde?');
    expect(mentions).toEqual([]);
  });

  it('"plan- och bygglagen" (PBL, known via a multi-word name pattern) is NOT flagged -- overlap detection covers phrase-based recognition, not just single words', () => {
    const mentions = findUnrecognizedStatuteMentions('Vad innehåller plan- och bygglagen för bestämmelser?');
    expect(mentions).toEqual([]);
  });

  it('a query naming no statute at all produces zero mentions', () => {
    expect(findUnrecognizedStatuteMentions('Hur borrar man en brunn på rätt sätt?')).toEqual([]);
  });

  it('denylisted common Swedish words are never flagged despite sharing the suffix', () => {
    expect(findUnrecognizedStatuteMentions('Vi väntar på förslaget från nämnden.')).toEqual([]);
    expect(findUnrecognizedStatuteMentions('Se bifogat underlaget för mer information.')).toEqual([]);
  });

  it('an explicit SFS number not matching any known source is flagged', () => {
    const mentions = findUnrecognizedStatuteMentions('Vad gäller enligt lagen (1998:812) med särskilda bestämmelser om vattenverksamhet?');
    expect(mentions).toContain('1998:812');
  });

  it('a known source referenced by its own real SFS number is NOT flagged', () => {
    expect(findUnrecognizedStatuteMentions('Vad gäller enligt 1998:808?')).toEqual([]);
  });

  it('is deterministic', () => {
    const q = 'Vad säger fiskelagen om fiskevård?';
    expect(findUnrecognizedStatuteMentions(q)).toEqual(findUnrecognizedStatuteMentions(q));
  });
});
