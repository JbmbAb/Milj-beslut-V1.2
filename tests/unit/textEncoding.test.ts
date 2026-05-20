import { describe, expect, it } from 'vitest';

import { looksLikeMojibake, normalizeExternalText, repairMojibake } from '../../server/utils/textEncoding';

describe('textEncoding', () => {
  it('repairs common Swedish mojibake', () => {
    expect(repairMojibake('MalmÃ¶ stad')).toBe('Malmö stad');
    expect(repairMojibake('InnehÃ¥ll med svenska tecken')).toBe('Innehåll med svenska tecken');
  });

  it('detects mojibake markers conservatively', () => {
    expect(looksLikeMojibake('MalmÃ¶')).toBe(true);
    expect(looksLikeMojibake('Malmö')).toBe(false);
  });

  it('normalizes whitespace and preserves valid utf8', () => {
    expect(normalizeExternalText('  Länsstyrelsen i Västra Götaland  ')).toBe(
      'Länsstyrelsen i Västra Götaland',
    );
  });
});
