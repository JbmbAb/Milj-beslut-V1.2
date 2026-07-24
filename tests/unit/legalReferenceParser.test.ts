/**
 * tests/unit/legalReferenceParser.test.ts
 *
 * Enhetstester för legalReferenceParser.ts
 * Kör: npm run test:unit
 */

import { describe, it, expect } from 'vitest';
import {
  parseLegalReference,
  normalizeParagraph,
} from '../../server/modules/legal/services/legalReferenceParser';

describe('parseLegalReference', () => {
  // ─── SFS-nummer ──────────────────────────────────────────────────────────
  it('tolkar SFS 1998:808 som Miljöbalken', () => {
    const result = parseLegalReference('SFS 1998:808');
    expect(result).not.toBeNull();
    expect(result?.lawName).toBe('Miljöbalken');
    expect(result?.chapter).toBeUndefined();
  });

  it('tolkar SFS 2010:900 som Plan- och bygglagen', () => {
    const result = parseLegalReference('SFS 2010:900');
    expect(result?.lawName).toBe('Plan- och bygglagen');
  });

  it('returnerar null för okänt SFS-nummer', () => {
    const result = parseLegalReference('SFS 9999:999');
    expect(result).toBeNull();
  });

  // ─── Standard lagrum ─────────────────────────────────────────────────────
  it('tolkar "2 kap. 6 § Miljöbalken"', () => {
    const result = parseLegalReference('2 kap. 6 § Miljöbalken');
    expect(result?.chapter).toBe('2');
    expect(result?.paragraph).toBe('6');
  });

  it('tolkar "MB 9 kap. 6 §"', () => {
    const result = parseLegalReference('MB 9 kap. 6 §');
    expect(result?.lawName).toBe('Miljöbalken');
    expect(result?.chapter).toBe('9');
    expect(result?.paragraph).toBe('6');
  });

  it('tolkar omvänd ordning: "6 a § 2 kap MB"', () => {
    const result = parseLegalReference('6 a § 2 kap MB');
    expect(result?.chapter).toBe('2');
    expect(result?.paragraph).toBe('6a');
  });

  it('tolkar kompakt format: "2:6"', () => {
    const result = parseLegalReference('2:6');
    expect(result?.chapter).toBe('2');
    expect(result?.paragraph).toBe('6');
  });

  it('tolkar bokstavsparagraf: "2 kap. 6 a §"', () => {
    const result = parseLegalReference('2 kap. 6 a §');
    expect(result?.paragraph).toBe('6a');
  });

  // ─── Stycken & punkter ───────────────────────────────────────────────────
  it('tolkar stycke: "2 kap. 6 § första stycket"', () => {
    const result = parseLegalReference('2 kap. 6 § första stycket');
    expect(result?.chapter).toBe('2');
    expect(result?.paragraph).toBe('6');
    expect(result?.subsection).toBe('första');
  });

  it('tolkar punkt: "3 kap. 12 § tredje punkten"', () => {
    const result = parseLegalReference('3 kap. 12 § tredje punkten');
    expect(result?.paragraph).toBe('12');
    // item extraheras från ordningstal i texten
  });

  it('tolkar numerisk punkt: "9 kap. 4 § 3 punkten"', () => {
    const result = parseLegalReference('9 kap. 4 § 3 punkten');
    expect(result?.paragraph).toBe('4');
    expect(result?.item).toBe('3');
  });

  // ─── Fallback ────────────────────────────────────────────────────────────
  it('returnerar null för fri text utan lagrum', () => {
    const result = parseLegalReference('vad gäller vid strandskydd generellt?');
    expect(result).toBeNull();
  });

  it('returnerar null för tom sträng', () => {
    const result = parseLegalReference('');
    expect(result).toBeNull();
  });
});

describe('normalizeParagraph', () => {
  it('normaliserar "6 a" till "6a"', () => {
    expect(normalizeParagraph('6 a')).toBe('6a');
  });

  it('normaliserar "12 b" till "12b"', () => {
    expect(normalizeParagraph('12 b')).toBe('12b');
  });

  it('lämnar "6" oförändrat', () => {
    expect(normalizeParagraph('6')).toBe('6');
  });
});
