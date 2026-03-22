import { describe, expect, it } from 'vitest';

import {
  extractDiarie,
  extractDiarieSignal,
  extractMunicipalityWeighted,
} from '../../scripts/backfill/_shared';

describe('backfill shared helpers', () => {
  it('extracts diarienummer from arende pattern', () => {
    expect(extractDiarie('Inkommen: 2024-07-03 | Ärende: E-2024-1335')).toBe('E-2024-1335');
  });

  it('extracts diarienummer from dnr pattern with leading text', () => {
    expect(extractDiarie('Datum Dnr Miljö- och hälsoenheten 2024-08-06 E-2024-1335')).toBe('E-2024-1335');
  });

  it('extracts diarienummer from arendenr pattern without letter prefix', () => {
    expect(extractDiarie('Ärende.nr: 2024-746')).toBe('2024-746');
  });

  it('extracts diarienummer from filename-style prefix', () => {
    expect(extractDiarie('2024-746Föreläggande om skyddsåtgärder.pdf')).toBe('2024-746');
  });

  it('extracts dotted diarienummer from document text labels', () => {
    expect(extractDiarie('Diarienummer: MIL.2024.1156')).toBe('MIL.2024.1156');
  });

  it('extracts underscore diarienummer from filenames and normalizes to dots', () => {
    expect(extractDiarie('MIL_2025_2535.zip')).toBe('MIL.2025.2535');
  });

  it('extracts dotted numeric diarienummer from filenames', () => {
    expect(extractDiarie('2024.1156.pdf')).toBe('2024.1156');
  });

  it('returns threshold-safe confidence for explicit diarienummer markers in text', () => {
    const result = extractDiarieSignal('Dnr: E-2024-1335');

    expect(result.value).toBe('E-2024-1335');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('combines manifest municipality and sender email into high-confidence match', () => {
    const result = extractMunicipalityWeighted({
      subject: 'Sv: till registrator',
      senderEmail: 'josefin.nystrom@ornskoldsvik.se',
      manifestMunicipality: 'ornskoldsvik',
    });

    expect(result.value).toBe('Örnsköldsvik');
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });
});
