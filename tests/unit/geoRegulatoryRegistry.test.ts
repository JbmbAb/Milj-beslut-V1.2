import { describe, it, expect } from 'vitest';
import {
  getGeoRegulatoryRulePack,
  listGeoRegulatoryRulePacks,
  resolvePrimaryRulePack,
  collectRequiredReviewGates,
} from '../../server/geo-regulatory/registry';
import {
  GEO_REGULATORY_DOMAIN_PACKS,
  GEO_REGULATORY_CORE_CAPABILITIES,
} from '../../server/geo-regulatory/catalog';
import type { GeoRegulatoryAssessmentRequest } from '../../server/geo-regulatory/types';

describe('geo-regulatory registry & catalog', () => {
  describe('GEO_REGULATORY_CORE_CAPABILITIES', () => {
    it('innehåller spatial_lookup', () => {
      expect(GEO_REGULATORY_CORE_CAPABILITIES).toContain('spatial_lookup');
    });

    it('innehåller regulatory_evaluation', () => {
      expect(GEO_REGULATORY_CORE_CAPABILITIES).toContain('regulatory_evaluation');
    });

    it('innehåller risk_scoring', () => {
      expect(GEO_REGULATORY_CORE_CAPABILITIES).toContain('risk_scoring');
    });

    it('innehåller document_generation', () => {
      expect(GEO_REGULATORY_CORE_CAPABILITIES).toContain('document_generation');
    });
  });

  describe('GEO_REGULATORY_DOMAIN_PACKS', () => {
    it('innehåller minst ett rule pack', () => {
      expect(GEO_REGULATORY_DOMAIN_PACKS.length).toBeGreaterThan(0);
    });

    it('core.sewage.v1 existerar', () => {
      const sewage = GEO_REGULATORY_DOMAIN_PACKS.find((p) => p.id === 'core.sewage.v1');
      expect(sewage).toBeDefined();
      expect(sewage?.domain).toBe('sewage');
    });

    it('varje pack har id, domain, displayName, version', () => {
      for (const pack of GEO_REGULATORY_DOMAIN_PACKS) {
        expect(pack.id).toBeTruthy();
        expect(pack.domain).toBeTruthy();
        expect(pack.displayName).toBeTruthy();
        expect(pack.version).toBeTruthy();
      }
    });

    it('varje pack har reviewGates med id och label', () => {
      for (const pack of GEO_REGULATORY_DOMAIN_PACKS) {
        expect(Array.isArray(pack.reviewGates)).toBe(true);
        for (const gate of pack.reviewGates) {
          expect(gate.id).toBeTruthy();
          expect(gate.label).toBeTruthy();
        }
      }
    });
  });

  describe('getGeoRegulatoryRulePack', () => {
    it('returnerar rätt pack för känt id', () => {
      const pack = getGeoRegulatoryRulePack('core.sewage.v1');
      expect(pack).toBeDefined();
      expect(pack?.id).toBe('core.sewage.v1');
    });

    it('returnerar undefined för okänt id', () => {
      expect(getGeoRegulatoryRulePack('non.existent.v1')).toBeUndefined();
    });
  });

  describe('listGeoRegulatoryRulePacks', () => {
    it('returnerar alla packs när inget domain anges', () => {
      const all = listGeoRegulatoryRulePacks();
      expect(all.length).toBe(GEO_REGULATORY_DOMAIN_PACKS.length);
    });

    it('returnerar bara sewage-packs för domain=sewage', () => {
      const packs = listGeoRegulatoryRulePacks('sewage');
      expect(packs.every((p) => p.domain === 'sewage')).toBe(true);
      expect(packs.length).toBeGreaterThan(0);
    });

    it('returnerar tom array för okänt domain', () => {
      expect(listGeoRegulatoryRulePacks('unknown_domain' as any)).toEqual([]);
    });

    it('returnerar kopia (mutation påverkar ej original)', () => {
      const list = listGeoRegulatoryRulePacks();
      const originalLen = GEO_REGULATORY_DOMAIN_PACKS.length;
      list.push({} as any);
      expect(GEO_REGULATORY_DOMAIN_PACKS.length).toBe(originalLen);
    });
  });

  describe('resolvePrimaryRulePack', () => {
    it('returnerar första pack för sewage-domain', () => {
      const pack = resolvePrimaryRulePack('sewage');
      expect(pack).toBeDefined();
      expect(pack?.domain).toBe('sewage');
    });

    it('returnerar undefined för domain utan packs', () => {
      expect(resolvePrimaryRulePack('unknown_domain' as any)).toBeUndefined();
    });
  });

  describe('collectRequiredReviewGates', () => {
    it('returnerar gate-ids för giltig request', () => {
      const request: GeoRegulatoryAssessmentRequest = {
        domain: 'sewage',
      } as GeoRegulatoryAssessmentRequest;

      const gates = collectRequiredReviewGates(request);
      expect(Array.isArray(gates)).toBe(true);
      expect(gates.length).toBeGreaterThan(0);
      // Should include before_binding_assessment
      expect(gates).toContain('before_binding_assessment');
    });

    it('returnerar tom array för okänt domain', () => {
      const request = { domain: 'nonexistent' as any } as GeoRegulatoryAssessmentRequest;
      expect(collectRequiredReviewGates(request)).toEqual([]);
    });
  });
});
