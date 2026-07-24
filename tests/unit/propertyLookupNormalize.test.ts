import { describe, it, expect } from 'vitest';
import {
  normalizePropertyLookupBody,
  normalizeLantmaterietDesignationNotation,
} from '../../server/security/propertyLookupNormalize';

describe('normalizePropertyLookupBody', () => {
  it('hanterar propertyDesignation-fältet', () => {
    const result = normalizePropertyLookupBody({ propertyDesignation: 'GÄVLE BRYNÄS 1:1' });
    expect(result.propertyDesignation).toBe('GÄVLE BRYNÄS 1:1');
    expect(result.purpose).toBe('API_LOOKUP');
    expect(result.projectId).toBe('');
  });

  it('hanterar designation-fältet som alias', () => {
    const result = normalizePropertyLookupBody({ designation: '  NACKA SICKLA 1:1  ' });
    expect(result.propertyDesignation).toBe('NACKA SICKLA 1:1');
  });

  it('prefererar propertyDesignation framför designation', () => {
    const result = normalizePropertyLookupBody({
      propertyDesignation: 'STOCKHOLM 1:1',
      designation: 'ANNAN 2:2',
    });
    expect(result.propertyDesignation).toBe('STOCKHOLM 1:1');
  });

  it('extraherar projectId och purpose', () => {
    const result = normalizePropertyLookupBody({
      propertyDesignation: 'MALMÖ 3:4',
      projectId: '  proj-123  ',
      purpose: '  SITE_ANALYSIS  ',
    });
    expect(result.projectId).toBe('proj-123');
    expect(result.purpose).toBe('SITE_ANALYSIS');
  });

  it('sätter purpose till API_LOOKUP om tomt', () => {
    const result = normalizePropertyLookupBody({ propertyDesignation: 'X', purpose: '  ' });
    expect(result.purpose).toBe('API_LOOKUP');
  });

  it('kastar fel om body är null', () => {
    expect(() => normalizePropertyLookupBody(null)).toThrow('Ogiltig begäran');
  });

  it('kastar fel om body är en sträng', () => {
    expect(() => normalizePropertyLookupBody('ogiltig')).toThrow('Ogiltig begäran');
  });

  it('hanterar tom body-objekt', () => {
    const result = normalizePropertyLookupBody({});
    expect(result.propertyDesignation).toBe('');
    expect(result.projectId).toBe('');
    expect(result.purpose).toBe('API_LOOKUP');
  });

  it('hanterar numerisk designation som tom sträng', () => {
    const result = normalizePropertyLookupBody({ propertyDesignation: 42 });
    expect(result.propertyDesignation).toBe('');
  });
});

describe('normalizeLantmaterietDesignationNotation', () => {
  it('konverterar parentesbeteckning till OGC-suffix', () => {
    expect(normalizeLantmaterietDesignationNotation('GÄVLE 3:12 (2)')).toBe('GÄVLE 3:12>2');
  });

  it('lämnar beteckning utan parentes oförändrad', () => {
    expect(normalizeLantmaterietDesignationNotation('NACKA SICKLA 1:1')).toBe('NACKA SICKLA 1:1');
  });

  it('hanterar extra blanksteg kring parentes', () => {
    expect(normalizeLantmaterietDesignationNotation('STOCKHOLM 5:10  (3)  ')).toBe('STOCKHOLM 5:10>3');
  });

  it('hanterar tom sträng', () => {
    expect(normalizeLantmaterietDesignationNotation('')).toBe('');
  });

  it('hanterar undefined-liknande värden via typkonvertering', () => {
    expect(normalizeLantmaterietDesignationNotation(null as unknown as string)).toBe('');
  });

  it('ändrar inte beteckning med (text) i mitten', () => {
    // Endast avslutande parentes med siffra ska normaliseras
    expect(normalizeLantmaterietDesignationNotation('GÄVLE (centrum) 1:1')).toBe('GÄVLE (centrum) 1:1');
  });
});
