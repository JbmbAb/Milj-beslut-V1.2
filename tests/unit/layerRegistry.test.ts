import { describe, expect, it } from 'vitest';
import { getLayer } from '../../app/services/layerRegistry';

describe('layerRegistry', () => {
  it('resolves direct layer identifiers', () => {
    const layer = getLayer('sgu.jordarter');
    expect(layer).toBeDefined();
    expect(layer?.schema).toBe('sgu');
    expect(layer?.table).toBe('jordarter25k_100k');
  });

  it('resolves friendly slash-style aliases', () => {
    const layer = getLayer('sgu/jordarter');
    expect(layer).toBeDefined();
    expect(layer?.id).toBe('sgu.jordarter');
  });

  it('resolves raster layer aliases for nmd2023', () => {
    const layer = getLayer('nmd2023');
    expect(layer).toBeDefined();
    expect(layer?.kind).toBe('raster');
    expect(layer?.table).toBe('nmd2023bas_v2_1');
  });

  it('returns undefined for unknown layers', () => {
    expect(getLayer('unknown.layer')).toBeUndefined();
  });
});
