import { describe, expect, it } from 'vitest';
import {
  getSourceDefinition,
  getAllSources,
  isUrlAllowedForSource
} from '../../../server/modules/harvest/source-registry/registry';

describe('🜂 Loke Source Registry (LSF-01)', () => {
  it('correctly retrieves specific source definitions', () => {
    const source = getSourceDefinition('mmd_nacka');
    expect(source).not.toBeNull();
    expect(source!.sourceId).toBe('mmd_nacka');
    expect(source!.authority.type).toBe('court');
    expect(source!.adapter).toBe('mmd_v1');
    expect(source!.allowedDomains).toContain('domstol.se');
  });

  it('correctly returns null for unregistered sources', () => {
    const source = getSourceDefinition('unregistered_source');
    expect(source).toBeNull();
  });

  it('returns all active sources in the registry', () => {
    const all = getAllSources();
    expect(all.length).toBeGreaterThan(0);
    expect(all.some(s => s.sourceId === 'mpd_dalarna')).toBe(true);
  });

  describe('isUrlAllowedForSource (Crawler Leak Protection)', () => {
    it('allows valid domains and their subdomains', () => {
      // mmd_nacka allows 'domstol.se'
      expect(isUrlAllowedForSource('mmd_nacka', 'https://www.domstol.se/nacka-tingsratt/dom.pdf')).toBe(true);
      expect(isUrlAllowedForSource('mmd_nacka', 'http://nacka.domstol.se/files/beslut.txt')).toBe(true);
    });

    it('denies unrelated domains', () => {
      // mmd_nacka does NOT allow 'skadlighemsida.se'
      expect(isUrlAllowedForSource('mmd_nacka', 'https://skadlighemsida.se/domstol.se/dom.pdf')).toBe(false);
    });

    it('denies valid domains attached to wrong sources', () => {
      // mmd_nacka does NOT allow 'lansstyrelsen.se'
      expect(isUrlAllowedForSource('mmd_nacka', 'https://www.lansstyrelsen.se/dalarna/beslut.pdf')).toBe(false);
    });
  });
});
