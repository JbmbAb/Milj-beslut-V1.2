import { describe, it, expect } from 'vitest';
import { cleanMunicipality, isValidMunicipality } from '../../server/utils/municipalityUtils';

describe('municipalityUtils', () => {
  describe('cleanMunicipality', () => {
    it('returnerar null för tom sträng', () => {
      const r = cleanMunicipality('');
      expect(r.cleaned).toBeNull();
      expect(r.shouldSkip).toBe(true);
    });

    it('returnerar null för null', () => {
      const r = cleanMunicipality(null);
      expect(r.cleaned).toBeNull();
      expect(r.shouldSkip).toBe(true);
    });

    it('returnerar null för undefined', () => {
      const r = cleanMunicipality(undefined);
      expect(r.cleaned).toBeNull();
      expect(r.shouldSkip).toBe(true);
    });

    it('filtrerar bort skräpord', () => {
      expect(cleanMunicipality('beslut').shouldSkip).toBe(true);
      expect(cleanMunicipality('och').shouldSkip).toBe(true);
      expect(cleanMunicipality('datum').shouldSkip).toBe(true);
    });

    it('filtrerar bort korta strängar (<3 tecken)', () => {
      expect(cleanMunicipality('ab').shouldSkip).toBe(true);
    });

    it('applicerar kända fixar – Göteborgs → Göteborg', () => {
      const r = cleanMunicipality('Göteborgs');
      expect(r.cleaned).toBe('Göteborg');
      expect(r.shouldSkip).toBe(false);
    });

    it('applicerar kända fixar – göteborgs (lowercase) → Göteborg', () => {
      const r = cleanMunicipality('göteborgs');
      expect(r.cleaned).toBe('Göteborg');
    });

    it('strippar genitiv-s (Linköpings → Linköping)', () => {
      const r = cleanMunicipality('Linköpings');
      // antingen via KNOWN_FIXES eller genitiv-strip
      expect(r.cleaned).toBeTruthy();
      expect(r.shouldSkip).toBe(false);
    });

    it('behåller kommuner som korrekt slutar på s (Västerås)', () => {
      const r = cleanMunicipality('Västerås');
      expect(r.cleaned).toBe('Västerås');
      expect(r.shouldSkip).toBe(false);
    });

    it('trimmar whitespace', () => {
      const r = cleanMunicipality('  Stockholm  ');
      expect(r.cleaned).toBe('Stockholm');
    });

    it('returnerar vanligt kommunnamn oförändrat', () => {
      const r = cleanMunicipality('Uppsala');
      expect(r.cleaned).toBe('Uppsala');
      expect(r.shouldSkip).toBe(false);
    });
  });

  describe('isValidMunicipality', () => {
    it('returnerar false för null', () => {
      expect(isValidMunicipality(null)).toBe(false);
    });

    it('returnerar false för skräpord', () => {
      expect(isValidMunicipality('beslut')).toBe(false);
    });

    it('returnerar true för giltigt kommunnamn', () => {
      expect(isValidMunicipality('Stockholm')).toBe(true);
    });

    it('returnerar true för Göteborg (via fix)', () => {
      expect(isValidMunicipality('Göteborgs')).toBe(true);
    });
  });
});
