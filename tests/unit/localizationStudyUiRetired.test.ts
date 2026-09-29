/**
 * W3a -- Q3: "retire the component and the export-pdf route together. The component is
 * unreachable, the route has no other caller, and D-P5-5 says the legacy PDF path is not the
 * product path."
 *
 * `components/LocalizationStudyUI.tsx` was confirmed unreachable from the live app during the W3
 * design round (only its own test imported it; `LuWorkspace.tsx` is the live replacement surface)
 * and was the only caller of the `export-pdf` route (see localizationRoutes.test.ts's own
 * retirement proof for that half). This proves the component file itself is actually gone, not
 * merely unreferenced.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('W3a: LocalizationStudyUI.tsx has been retired (Q3)', () => {
  it('the component file no longer exists on disk', () => {
    expect(existsSync('components/LocalizationStudyUI.tsx')).toBe(false);
  });

  it('the component\'s own test file no longer exists on disk', () => {
    expect(existsSync('tests/components/localizationStudyUI.test.tsx')).toBe(false);
  });
});
