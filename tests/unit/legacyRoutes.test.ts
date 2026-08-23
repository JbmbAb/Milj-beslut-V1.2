import { afterEach, describe, expect, it } from 'vitest';
import { isLegacyRoutesEnabled } from '../../server/security/legacyRoutes';

describe('isLegacyRoutesEnabled', () => {
  const original = process.env.LEGACY_ROUTES_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.LEGACY_ROUTES_ENABLED;
    else process.env.LEGACY_ROUTES_ENABLED = original;
  });

  it('defaults to false (unset)', () => {
    delete process.env.LEGACY_ROUTES_ENABLED;
    expect(isLegacyRoutesEnabled()).toBe(false);
  });

  it('is false for any value other than the literal "true"', () => {
    process.env.LEGACY_ROUTES_ENABLED = '1';
    expect(isLegacyRoutesEnabled()).toBe(false);
    process.env.LEGACY_ROUTES_ENABLED = 'yes';
    expect(isLegacyRoutesEnabled()).toBe(false);
  });

  it('is true only when explicitly set to "true"', () => {
    process.env.LEGACY_ROUTES_ENABLED = 'true';
    expect(isLegacyRoutesEnabled()).toBe(true);
  });

  it('this policy is independent of uiConfig.enableLegacyUi -- no import of mps-console exists in this module', () => {
    // Regression guard for the specific mistake this unit exists to prevent: server-side
    // route mounting must never be decided by a client/Vite build flag.
    const fs = require('fs') as typeof import('fs');
    const source = fs.readFileSync(require.resolve('../../server/security/legacyRoutes.ts'), 'utf8');
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/mps-console|import.*uiConfig/);
  });
});
