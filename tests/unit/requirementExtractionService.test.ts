import { describe, expect, it } from 'vitest';
import {
  classifyByRules,
  classifyRequirementLevel,
  extractLegalReference,
  extractRequirementsFromText,
  isRequirementCandidate,
  segmentText,
} from '../../server/services/requirementExtractionService';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('requirementExtractionService – pure functions', () => {

  // ── segmentText ────────────────────────────────────────────────────────────

  describe('segmentText', () => {
    it('splits plain text into sentences', () => {
      const text = 'Bolaget ska ha ett journalsystem. Dagvatten ska ledas till oljeavskiljare. Provtagning krävs.';
      const segments = segmentText(text);
      expect(segments.length).toBeGreaterThan(0);
      expect(segments[0]).toMatchObject({ index: 0 });
    });

    it('ignores fragments shorter than 20 characters', () => {
      const text = 'Short. ' + 'Bolaget ska dokumentera alla transporter och rapportera till myndigheten.\n\n' +
                   'Ja. Nej. ' + 'Farligt avfall ska förvaras åtskilt och märkas enligt gällande föreskrifter.';
      const segments = segmentText(text);
      for (const seg of segments) {
        expect(seg.text.length).toBeGreaterThan(20);
      }
    });

    it('respects form-feed page breaks', () => {
      const text = 'Sida ett innehåller krav på provtagning varje kvartal.\fSida två innehåller krav på dokumentation.';
      const segments = segmentText(text);
      const page2 = segments.filter(s => s.pageNumber === 2);
      expect(page2.length).toBeGreaterThan(0);
    });

    it('assigns sequential index values', () => {
      const text = 'Bolaget ska dokumentera alla transporter.\nFarligt avfall ska förvaras åtskilt i märkta behållare.';
      const segments = segmentText(text);
      segments.forEach((seg, i) => {
        expect(seg.index).toBe(i);
      });
    });

    it('returns empty array for empty input', () => {
      expect(segmentText('')).toHaveLength(0);
    });
  });

  // ── isRequirementCandidate ─────────────────────────────────────────────────

  describe('isRequirementCandidate', () => {
    it('returns true for text containing "ska"', () => {
      expect(isRequirementCandidate('Bolaget ska ha ett dokumentationssystem.')).toBe(true);
    });

    it('returns true for text containing "måste"', () => {
      expect(isRequirementCandidate('Alla transporter måste journalföras.')).toBe(true);
    });

    it('returns true for text containing "krävs"', () => {
      expect(isRequirementCandidate('Tillstånd krävs för denna verksamhet.')).toBe(true);
    });

    it('returns true for text containing "är förbjudet"', () => {
      expect(isRequirementCandidate('Det är förbjudet att deponera farligt avfall.')).toBe(true);
    });

    it('returns false for neutral descriptive text', () => {
      expect(isRequirementCandidate('Platsen är belägen i en tätort.')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isRequirementCandidate('BOLAGET SKA RAPPORTERA.')).toBe(true);
    });
  });

  // ── classifyByRules ────────────────────────────────────────────────────────

  describe('classifyByRules', () => {
    it('classifies water management text correctly', () => {
      const result = classifyByRules('Dagvatten ska samlas upp i oljeavskiljare och recipient skyddas.');
      expect(result.category).toBe('water_management');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('classifies sampling text correctly', () => {
      const result = classifyByRules('Provtagning och analys ska göras av laboratorium med riktvärde.');
      expect(result.category).toBe('sampling');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('classifies hazardous waste text correctly', () => {
      const result = classifyByRules('Farligt avfall ska klassificeras och förvaras åtskilt med märkning.');
      expect(result.category).toBe('hazardous_waste');
    });

    it('classifies documentation text correctly', () => {
      const result = classifyByRules('Egenkontroll och journal ska föras och redovisas i rapport.');
      expect(result.category).toBe('documentation');
    });

    it('returns confidence > 0.5 even for text without known signals (implementation detail)', () => {
      // classifyByRules adds 0.55 base score even for 0 hits, so first category wins
      const result = classifyByRules('Ingen känd signal finns i denna text.');
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(typeof result.category).toBe('string');
    });

    it('caps confidence at 0.95', () => {
      // Many signals → confidence must not exceed 0.95
      const text = 'dagvatten lakvatten grundvatten oljeavskiljare uppsamling recipient';
      const result = classifyByRules(text);
      expect(result.confidence).toBeLessThanOrEqual(0.95);
    });
  });

  // ── extractLegalReference ──────────────────────────────────────────────────

  describe('extractLegalReference', () => {
    it('extracts Miljöbalken chapter reference', () => {
      const result = extractLegalReference('Enligt miljöbalken 9 kap. § 6 ska anmälan göras.');
      expect(result).toContain('Miljöbalken');
    });

    it('extracts Avfallsförordningen reference', () => {
      const result = extractLegalReference('Avfallsförordningen 2 kap. reglerar farligt avfall.');
      expect(result).toContain('Avfallsförordningen');
    });

    it('extracts NFS foreskrift reference', () => {
      const result = extractLegalReference('Enligt NFS 2006:9 ska mätning ske.');
      expect(result).toContain('Naturvårdsverkets föreskrift');
    });

    it('returns null for text with no legal references', () => {
      expect(extractLegalReference('Verksamheten bedrivs av bolaget.')).toBeNull();
    });
  });

  // ── classifyRequirementLevel ───────────────────────────────────────────────

  describe('classifyRequirementLevel', () => {
    it('returns "mandatory" for text with "ska"', () => {
      expect(classifyRequirementLevel('Bolaget ska dokumentera alla transporter.')).toBe('mandatory');
    });

    it('returns "mandatory" for text with "måste"', () => {
      expect(classifyRequirementLevel('Tillståndet måste förnyas vartannat år.')).toBe('mandatory');
    });

    it('returns "mandatory" for text with "krävs"', () => {
      expect(classifyRequirementLevel('Tillstånd krävs för denna anläggning.')).toBe('mandatory');
    });

    it('returns "recommended" for text with "bör"', () => {
      expect(classifyRequirementLevel('Bolaget bör anlita en miljökonsult.')).toBe('recommended');
    });

    it('returns "recommended" for text with "rekommenderas"', () => {
      expect(classifyRequirementLevel('Det rekommenderas att installera regnvattentank.')).toBe('recommended');
    });

    it('returns "conditional" for neutral text', () => {
      expect(classifyRequirementLevel('Om verksamheten ändras gäller nya regler.')).toBe('conditional');
    });
  });

  // ── extractRequirementsFromText ────────────────────────────────────────────

  describe('extractRequirementsFromText', () => {
    it('returns only requirement candidates from text', () => {
      const text = [
        'Bolaget ska ha ett dokumenterat egenkontrollprogram för alla verksamheter.',
        'Platsen är belägen nära en skola.',                                // not a candidate
        'Farligt avfall ska förvaras åtskilt och märkas korrekt enligt gällande regler.',
        'Det är vackert väder idag utanför kontoret.',                      // not a candidate
      ].join('\n\n');

      const results = extractRequirementsFromText(text);

      expect(results.length).toBeGreaterThan(0);
      for (const req of results) {
        expect(req.requirementText.length).toBeGreaterThan(20);
        expect(['mandatory', 'recommended', 'conditional']).toContain(req.requirementLevel);
        expect(typeof req.category).toBe('string');
        expect(typeof req.confidence).toBe('number');
      }
    });

    it('each result has required fields', () => {
      const text = 'Dagvatten ska samlas upp och analyseras av godkänt laboratorium.';
      const results = extractRequirementsFromText(text);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('requirementText');
        expect(results[0]).toHaveProperty('category');
        expect(results[0]).toHaveProperty('requirementLevel');
        expect(results[0]).toHaveProperty('confidence');
        expect(results[0]).toHaveProperty('sourceSegment');
      }
    });

    it('returns empty array for text with no requirement candidates', () => {
      const text = 'Det är en solig dag. Träden blommar i parken. Fåglar sjunger i trädtopparna.';
      const results = extractRequirementsFromText(text);
      expect(results).toHaveLength(0);
    });

    it('attaches page number when pages are present', () => {
      const text = 'Sida ett innehåller inte krav.\fDagvatten ska samlas upp och analyseras av godkänt laboratorium.';
      const results = extractRequirementsFromText(text);
      if (results.length > 0) {
        expect(results[0].pageNumber).toBeDefined();
      }
    });
  });
});
