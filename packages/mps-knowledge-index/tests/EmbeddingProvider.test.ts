import { describe, expect, it } from 'vitest';

import {
  cosineSimilarity,
  createDeterministicHashEmbeddingProvider,
  fitIdfTable,
  stemSwedish,
  tokenizeForFixtureEmbedding,
} from '../src';

describe('K2.2 fixture embedding — Snowball Swedish stems, exact-vocabulary mode, query coverage', () => {
  it('stems inflected forms of one lemma to one stem (Snowball Swedish, steps 1-3)', () => {
    for (const [a, b] of [
      ['tillsyn', 'tillsynen'],
      ['syfte', 'syftar'],
      ['miljöbalken', 'miljöbalkens'],
      ['verksamhet', 'verksamheten'],
      ['verksamhet', 'verksamheter'],
      ['miljöfarlig', 'miljöfarliga'],
      ['förelägganden', 'föreläggande'],
    ]) {
      expect(stemSwedish(a!), `${a} vs ${b}`).toBe(stemSwedish(b!));
    }
    expect(stemSwedish('orimligt')).toBe('orim'); // step 2 drops the t of "gt", step 3 removes "lig"
    expect(stemSwedish('orimliga')).toBe('orim');
    expect(stemSwedish('jaktkarlarne')).toBe('jaktkarl'); // Snowball reference vocabulary
    expect(stemSwedish('klokast')).toBe('klok');
    expect(stemSwedish('bo')).toBe('bo'); // shorter than R1: untouched
  });

  it('tokenizer drops stopwords/short tokens before stemming and is deterministic', () => {
    expect(tokenizeForFixtureEmbedding('Vad är miljöbalkens syfte och mål om hållbar utveckling?')).toEqual(
      tokenizeForFixtureEmbedding('vad ÄR Miljöbalkens syfte, och mål om hållbar utveckling'),
    );
    expect(tokenizeForFixtureEmbedding('Vad är miljöbalkens syfte?')).not.toContain('vad');
    expect(tokenizeForFixtureEmbedding('i § 1')).toEqual([]);
  });

  it('exact-vocabulary mode: one dimension per fitted stem plus the reserved bucket 0, bound into model_version', () => {
    const idf = fitIdfTable([
      'tillsynen ska säkerställa syftet',
      'tillsynsmyndigheten får besluta om förelägganden',
    ]);
    const provider = createDeterministicHashEmbeddingProvider({ idf });
    expect(provider.dimensions).toBe(idf.document_frequency.size + 1);
    expect(provider.model_version).toBe(`1+idf:${idf.identity}`);
    expect(() => createDeterministicHashEmbeddingProvider({ idf, dimensions: 512 })).toThrow(
      /do not pass dimensions/,
    );
    const again = fitIdfTable([
      'tillsynen ska säkerställa syftet',
      'tillsynsmyndigheten får besluta om förelägganden',
    ]);
    expect(again.identity).toBe(idf.identity);
    expect(fitIdfTable(['något helt annat']).identity).not.toBe(idf.identity);
  });

  it('a document never writes bucket 0 and an out-of-vocabulary document term contributes nothing', async () => {
    const idf = fitIdfTable(['buller vid bostäder', 'grundvatten i brunn']);
    const provider = createDeterministicHashEmbeddingProvider({ idf });
    const [known, withOov, onlyOov] = await provider.embedDocuments([
      'buller vid bostäder',
      'buller vid bostäder kvantfysik',
      'kvantfysik supraledning',
    ]);
    expect(known![0]).toBe(0);
    expect(withOov![0]).toBe(0);
    expect(cosineSimilarity(known!, withOov!)).toBeCloseTo(1, 10);
    expect(onlyOov!.every((x) => x === 0)).toBe(true);
  });

  it('query coverage: out-of-vocabulary query mass enters the query norm (bucket 0) so a mostly-unknown query cannot score on one shared token', async () => {
    const idf = fitIdfTable(['ishockey spelas på is', 'avfall ska sorteras', 'buller vid bostäder']);
    const provider = createDeterministicHashEmbeddingProvider({ idf });
    const doc = (await provider.embedDocuments(['ishockey spelas på is']))[0]!;
    const focused = await provider.embedQuery('ishockey');
    const mostlyUnknown = await provider.embedQuery('slutresultat VM-finalen ishockey Finland Kanada');
    expect(mostlyUnknown[0]).toBeGreaterThan(0);
    expect(doc[0]).toBe(0);
    const sFocused = cosineSimilarity(focused, doc);
    const sUnknown = cosineSimilarity(mostlyUnknown, doc);
    expect(sFocused).toBeGreaterThan(sUnknown);
    expect(sUnknown).toBeLessThan(0.5 * sFocused);
    // A fully out-of-vocabulary query has exactly zero similarity to everything.
    const nothing = await provider.embedQuery('kvantmekanisk supraledning');
    expect(cosineSimilarity(nothing, doc)).toBe(0);
  });

  it('hashed mode (no table) stays available for self-contained tests and is a different binding', async () => {
    const hashed = createDeterministicHashEmbeddingProvider({ dimensions: 64 });
    expect(hashed.dimensions).toBe(64);
    expect(hashed.model_version).toBe('1');
    const [a, b] = await hashed.embedDocuments(['buller vid bostäder', 'buller vid bostäder']);
    expect(a).toEqual(b);
    expect(() => createDeterministicHashEmbeddingProvider({ dimensions: 4 })).toThrow(/>= 8/);
  });
});
