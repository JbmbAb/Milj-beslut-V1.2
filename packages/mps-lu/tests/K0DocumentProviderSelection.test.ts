/**
 * K0 (DOC-EVIDENCE-CENSUS 2026-10-02) -- document provider selection for the legacy
 * LUBackendOrchestrator.generateDocumentEvidence path.
 *
 *  - The default (LU_DOC_PROVIDER unset) is the NullDocumentProvider, never the municipality-sweeping
 *    PostgisDocumentProvider (the old default).
 *  - MockDocumentProvider is selectable ONLY in explicit test mode (NODE_ENV=test and APP_ENV not
 *    staging/production). In any other mode LU_DOC_PROVIDER=mock fails closed; it never silently
 *    becomes a provider.
 *  - An unrecognised LU_DOC_PROVIDER value is a misconfiguration and fails closed (it used to fall
 *    through to "postgis").
 *
 * Hermetic: server/db/prisma is replaced by the guard (any access throws and is recorded), and the
 * MockDocumentProvider module is replaced by a counting stand-in so a forbidden selection is
 * observable even if it would otherwise succeed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../server/db/prisma', async () => (await import('../../../tests/helpers/hermeticPrismaGuard')).hermeticPrismaModule());

const mockProviderUse = vi.hoisted(() => ({ constructed: 0 }));
vi.mock('../../document-provider/src/MockDocumentProvider', () => ({
  MockDocumentProvider: class {
    constructor() {
      mockProviderUse.constructed += 1;
    }
    getProviderName() {
      return 'MockDocumentProvider';
    }
    async fetchDocumentsForGeometry() {
      return [{ document_ref: 'mock-doc', title: 'Mock document', metadata: {} }];
    }
  },
}));

import { hermeticPrismaTouches } from '../../../tests/helpers/hermeticPrismaGuard';
import { resolveDocumentProviderFromEnv } from '../src/providers/NullDocumentProvider';
import { LUBackendOrchestrator } from '../src/api/LUBackendOrchestrator';

const PROPERTY_REF = { artifact_id: 'property-context-k0', artifact_type: 'LU_PROPERTY_CONTEXT' } as const;
const GEOMETRY = { type: 'Polygon', coordinates: [[[18.1, 59.2], [18.2, 59.2], [18.2, 59.3], [18.1, 59.2]]] } as never;

const ORIGINAL = {
  LU_DOC_PROVIDER: process.env.LU_DOC_PROVIDER,
  NODE_ENV: process.env.NODE_ENV,
  APP_ENV: process.env.APP_ENV,
};

function restore(name: keyof typeof ORIGINAL): void {
  const value = ORIGINAL[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  mockProviderUse.constructed = 0;
  hermeticPrismaTouches.length = 0;
});

afterEach(() => {
  restore('LU_DOC_PROVIDER');
  restore('NODE_ENV');
  restore('APP_ENV');
});

describe('K0: resolveDocumentProviderFromEnv', () => {
  it('unset / empty / "null" -> "null" (the default is no longer the municipality-sweeping postgis provider)', () => {
    expect(resolveDocumentProviderFromEnv({ NODE_ENV: 'production' })).toBe('null');
    expect(resolveDocumentProviderFromEnv({ NODE_ENV: 'test' })).toBe('null');
    expect(resolveDocumentProviderFromEnv({ LU_DOC_PROVIDER: '' })).toBe('null');
    expect(resolveDocumentProviderFromEnv({ LU_DOC_PROVIDER: 'null' })).toBe('null');
    expect(resolveDocumentProviderFromEnv({ LU_DOC_PROVIDER: ' NULL ' })).toBe('null');
  });

  it('"postgis" stays an explicit opt-in only', () => {
    expect(resolveDocumentProviderFromEnv({ LU_DOC_PROVIDER: 'postgis', NODE_ENV: 'production' })).toBe('postgis');
  });

  it('"mock" is selectable only in explicit test mode', () => {
    expect(resolveDocumentProviderFromEnv({ LU_DOC_PROVIDER: 'mock', NODE_ENV: 'test' })).toBe('mock');
    expect(resolveDocumentProviderFromEnv({ LU_DOC_PROVIDER: 'MOCK', NODE_ENV: 'test', APP_ENV: 'local' })).toBe('mock');
  });

  it.each<[string, NodeJS.ProcessEnv]>([
    ['NODE_ENV=production', { LU_DOC_PROVIDER: 'mock', NODE_ENV: 'production' }],
    ['NODE_ENV=development', { LU_DOC_PROVIDER: 'mock', NODE_ENV: 'development' }],
    ['NODE_ENV unset', { LU_DOC_PROVIDER: 'mock' }],
    ['NODE_ENV=test but APP_ENV=production', { LU_DOC_PROVIDER: 'mock', NODE_ENV: 'test', APP_ENV: 'production' }],
    ['NODE_ENV=test but APP_ENV=Staging', { LU_DOC_PROVIDER: 'Mock', NODE_ENV: 'test', APP_ENV: 'Staging' }],
  ])('"mock" outside test mode (%s) fails closed', (_label, env) => {
    expect(() => resolveDocumentProviderFromEnv(env)).toThrow(/LU_DOC_PROVIDER_MOCK_FORBIDDEN/);
  });

  it('an unrecognised value fails closed instead of silently selecting a provider', () => {
    expect(() => resolveDocumentProviderFromEnv({ LU_DOC_PROVIDER: 'posgis', NODE_ENV: 'test' })).toThrow(/LU_DOC_PROVIDER_UNRECOGNIZED/);
    expect(() => resolveDocumentProviderFromEnv({ LU_DOC_PROVIDER: 'viss', NODE_ENV: 'production' })).toThrow(/LU_DOC_PROVIDER_UNRECOGNIZED/);
  });
});

describe('K0: LUBackendOrchestrator.generateDocumentEvidence provider selection', () => {
  it('production mode + LU_DOC_PROVIDER=mock -> rejects, MockDocumentProvider is never constructed', async () => {
    process.env.NODE_ENV = 'production';
    process.env.LU_DOC_PROVIDER = 'mock';
    await expect(new LUBackendOrchestrator().generateDocumentEvidence(PROPERTY_REF, GEOMETRY)).rejects.toThrow(
      /LU_DOC_PROVIDER_MOCK_FORBIDDEN/,
    );
    expect(mockProviderUse.constructed).toBe(0);
    expect(hermeticPrismaTouches).toEqual([]);
  });

  it('default (unset) -> no documents and no database access (NullDocumentProvider)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.LU_DOC_PROVIDER;
    await expect(new LUBackendOrchestrator().generateDocumentEvidence(PROPERTY_REF, GEOMETRY)).resolves.toEqual([]);
    expect(mockProviderUse.constructed).toBe(0);
    expect(hermeticPrismaTouches).toEqual([]);
  });

  it('explicit test mode + LU_DOC_PROVIDER=mock -> the mock is used (kept for tests only)', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.APP_ENV;
    process.env.LU_DOC_PROVIDER = 'mock';
    const evidence = await new LUBackendOrchestrator().generateDocumentEvidence(PROPERTY_REF, GEOMETRY);
    expect(mockProviderUse.constructed).toBe(1);
    expect(evidence).toHaveLength(1);
    expect(hermeticPrismaTouches).toEqual([]);
  });
});
