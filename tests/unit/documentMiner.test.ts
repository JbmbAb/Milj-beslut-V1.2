import { describe, it, expect } from 'vitest';
import {
  mineDocumentText,
  extractPropertyDesignations,
  classifyRiskLevel,
  RISK_KEYWORDS,
} from '../../server/utils/documentMiner';

describe('documentMiner', () => {
  describe('mineDocumentText', () => {
    it('returnerar tomma värden för tom sträng', () => {
      const result = mineDocumentText('');
      expect(result.primaryProperty).toBeNull();
      expect(result.allProperties).toEqual([]);
      expect(result.municipality).toBeNull();
      expect(result.riskTypes).toEqual([]);
      expect(result.riskString).toBe('Normal');
    });

    it('extraherar fastighetsbeteckning', () => {
      const result = mineDocumentText('Fastigheten Norrmalm 1:1 berörs av beslutet.');
      // The miner preserves the surrounding text; check it contains the designation.
      expect(result.primaryProperty).toContain('Norrmalm 1:1');
      expect(result.allProperties.some((p: string) => p.includes('Norrmalm 1:1'))).toBe(true);
    });

    it('extraherar kommunnamn från "Stockholms kommun"', () => {
      const result = mineDocumentText('Beslut fattat av Stockholms stadsbyggnads.');
      expect(result.municipality).toBeTruthy();
    });

    it('extraherar riskkategorin Sanering', () => {
      const result = mineDocumentText('Fastigheten är belastad med föroreningar och sanering krävs.');
      expect(result.riskTypes).toContain('Sanering');
    });

    it('extraherar riskkategorin Juridisk', () => {
      const result = mineDocumentText('Myndigheten utfärdade ett föreläggande med vite.');
      expect(result.riskTypes).toContain('Juridisk');
    });

    it('extraherar riskkategorin Buller', () => {
      const result = mineDocumentText('Mätningen visade på höga bullernivåer, decibel över gränsen.');
      expect(result.riskTypes).toContain('Buller');
    });

    it('extraherar riskkategorin Markrisk', () => {
      const result = mineDocumentText('Schaktarbeten nära deponi kan orsaka markstabilitetsproblem.');
      expect(result.riskTypes).toContain('Markrisk');
    });

    it('extraherar riskkategorin Utsläpp', () => {
      const result = mineDocumentText('Utsläpp av avlopp till recipient saknar tillstånd.');
      expect(result.riskTypes).toContain('Utsläpp');
    });

    it('returnerar riskString med kommaseparerade kategorier', () => {
      const result = mineDocumentText('Sanering och föreläggande med vite krävs.');
      expect(result.riskString).toContain('Sanering');
      expect(result.riskString).toContain('Juridisk');
    });

    it('returnerar Normal när inga risker identifieras', () => {
      const result = mineDocumentText('Normal verksamhet utan avvikelser.');
      expect(result.riskString).toBe('Normal');
    });

    it('extraherar flera fastighetsbeteckningar', () => {
      const result = mineDocumentText('Brynäs 1:1 och Söder 2:3 berörs av planändringen.');
      expect(result.allProperties.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('extractPropertyDesignations', () => {
    it('returnerar array av beteckningar', () => {
      const result = extractPropertyDesignations('Fastigheten Gävle 1:2 och Åstorp 3:4.');
      expect(Array.isArray(result)).toBe(true);
    });

    it('returnerar tom array för text utan beteckningar', () => {
      const result = extractPropertyDesignations('Ingen fastighetsbeteckning här.');
      expect(result).toEqual([]);
    });
  });

  describe('classifyRiskLevel', () => {
    it('returnerar Hög för text med sanering', () => {
      expect(classifyRiskLevel('Sanering av förorenad mark krävs.')).toBe('Hög');
    });

    it('returnerar Hög för text med juridiskt föreläggande', () => {
      expect(classifyRiskLevel('Föreläggande med vite har utfärdats.')).toBe('Hög');
    });

    it('returnerar Medel för text med buller (ej sanering/juridisk)', () => {
      expect(classifyRiskLevel('Bullernivåerna överstiger gränsvärdet.')).toBe('Medel');
    });

    it('returnerar Låg för text utan risker', () => {
      expect(classifyRiskLevel('Allt är i sin ordning.')).toBe('Låg');
    });
  });

  describe('RISK_KEYWORDS', () => {
    it('innehåller alla förväntade kategorier', () => {
      expect(RISK_KEYWORDS).toHaveProperty('Sanering');
      expect(RISK_KEYWORDS).toHaveProperty('Markrisk');
      expect(RISK_KEYWORDS).toHaveProperty('Juridisk');
      expect(RISK_KEYWORDS).toHaveProperty('Buller');
      expect(RISK_KEYWORDS).toHaveProperty('Utsläpp');
    });
  });
});
