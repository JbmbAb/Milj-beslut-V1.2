import { describe, expect, it } from 'vitest';
import {
  tokenize,
  freshnessWeight,
  sourceWeight,
  keywordOverlap,
} from '../../server/services/legalRelevanceService';

describe('legalRelevanceService.tokenize', () => {
  it('tokeniserar och tar bort diakritiska tecken', () => {
    const tokens = tokenize('Miljöbalken, avfallshantering i Uppsala!');
    expect(tokens).toContain('miljobalken');
    expect(tokens).toContain('avfallshantering');
    expect(tokens).toContain('uppsala');
  });

  it('filtrerar bort tokens kortare än 2 tecken', () => {
    expect(tokenize('a ab abc')).toEqual(['ab', 'abc']);
  });
});

describe('legalRelevanceService.sourceWeight', () => {
  it('ger högre vikt åt DOMSTOL_RSS än KOMMUN_DIARY', () => {
    expect(sourceWeight('DOMSTOL_RSS')).toBeGreaterThan(sourceWeight('KOMMUN_DIARY'));
  });

  it('matchar på delsträng (case-insensitive)', () => {
    expect(sourceWeight('some-domstol_rss-feed')).toBeCloseTo(1.25);
    expect(sourceWeight('internal')).toBeCloseTo(0.7);
  });

  it('default 1.0 vid okänt källsystem', () => {
    expect(sourceWeight('UNKNOWN_XYZ')).toBe(1.0);
    expect(sourceWeight(null)).toBe(1.0);
  });
});

describe('legalRelevanceService.freshnessWeight', () => {
  it('returnerar 1 för framtida datum (eller nu)', () => {
    expect(freshnessWeight(new Date())).toBeGreaterThan(0.99);
    expect(freshnessWeight(new Date(Date.now() + 10_000))).toBe(1);
  });

  it('halveras efter 365 dagar', () => {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    expect(freshnessWeight(oneYearAgo)).toBeCloseTo(0.5, 1);
  });

  it('0.4 fallback för saknat datum', () => {
    expect(freshnessWeight(null)).toBe(0.4);
    expect(freshnessWeight(undefined)).toBe(0.4);
  });
});

describe('legalRelevanceService.keywordOverlap', () => {
  it('returnerar 0 vid tom kandidat eller tom query', () => {
    expect(keywordOverlap([], 'text')).toBe(0);
    expect(keywordOverlap(['hello'], null)).toBe(0);
  });

  it('räknar träffar mot unika query-tokens', () => {
    const tokens = tokenize('miljöbalken avfall');
    const score = keywordOverlap(tokens, 'Uppsala tingsrätt tolkar miljöbalken avseende avfall');
    expect(score).toBeCloseTo(1, 2);
  });

  it('ger partiell score vid delvis match', () => {
    const tokens = tokenize('miljöbalken avfall kommun');
    const score = keywordOverlap(tokens, 'dom om avfall');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});
