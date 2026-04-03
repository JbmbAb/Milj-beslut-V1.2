import { describe, it, expect } from 'vitest';
import { classifySource, SOURCE_CATALOG, type SourceCatalogItem } from '../../server/datasources/catalog';

describe('catalog', () => {
  describe('SOURCE_CATALOG', () => {
    it('contains expected data sources', () => {
      expect(SOURCE_CATALOG.length).toBeGreaterThan(0);

      const lantmateriet = SOURCE_CATALOG.find(item => item.name === 'Lantmateriet');
      expect(lantmateriet).toBeDefined();
      expect(lantmateriet?.activation).toBe('PERMIT_REQUIRED');
      expect(lantmateriet?.implementationKey).toBe('lantmateriet_licensed');
    });

    it('includes both immediate and permit-required sources', () => {
      const immediate = SOURCE_CATALOG.filter(item => item.activation === 'IMMEDIATE');
      const permitRequired = SOURCE_CATALOG.filter(item => item.activation === 'PERMIT_REQUIRED');

      expect(immediate.length).toBeGreaterThan(0);
      expect(permitRequired.length).toBeGreaterThan(0);
    });

    it('all items have required fields', () => {
      SOURCE_CATALOG.forEach(item => {
        expect(item.name).toBeTruthy();
        expect(item.activation).toMatch(/^(IMMEDIATE|PERMIT_REQUIRED)$/);
        expect(item.reason).toBeTruthy();
      });
    });
  });

  describe('classifySource', () => {
    it('returns null for unknown sources', () => {
      const result = classifySource('NonExistentSource');
      expect(result).toBeNull();
    });

    it('classifies exact match (case insensitive)', () => {
      const result = classifySource('lantmateriet');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Lantmateriet');
    });

    it('classifies with uppercase input', () => {
      const result = classifySource('LANTMATERIET');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Lantmateriet');
    });

    it('classifies with extra whitespace', () => {
      const result = classifySource('  lantmateriet  ');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Lantmateriet');
    });

    it('classifies with diacritics (åäö)', () => {
      const result = classifySource('Naturvårdsverket');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Naturvardsverket');
    });

    it('classifies partial match - source name contains query', () => {
      const result = classifySource('SGU');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('SGU (Sveriges Geologiska Undersokning)');
    });

    it('handles parentheses in source names', () => {
      const result = classifySource('Fastighetsomrade ATOM');
      expect(result).not.toBeNull();
      expect(result?.implementationKey).toBe('lantmateriet_open_fastighetsomrade');
    });

    it('classifies BankID', () => {
      const result = classifySource('BankID');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('BankID');
      expect(result?.activation).toBe('PERMIT_REQUIRED');
    });

    it('classifies SMHI', () => {
      const result = classifySource('SMHI');
      expect(result).not.toBeNull();
      expect(result?.activation).toBe('IMMEDIATE');
      expect(result?.implementationKey).toBe('smhi');
    });

    it('classifies Trafikverket', () => {
      const result = classifySource('Trafikverket');
      expect(result).not.toBeNull();
      expect(result?.activation).toBe('PERMIT_REQUIRED');
      expect(result?.implementationKey).toBe('trafikverket');
    });

    it('returns the first match when multiple could match', () => {
      // "Lantmateriet" should match the first Lantmateriet entry
      const result = classifySource('Lantmateriet');
      expect(result).not.toBeNull();
      expect(result?.implementationKey).toBe('lantmateriet_licensed');
    });

    it('handles normalized strings with multiple spaces', () => {
      const result = classifySource('SGU     (Sveriges    Geologiska)');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('SGU (Sveriges Geologiska Undersokning)');
    });
  });
});
