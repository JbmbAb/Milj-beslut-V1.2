import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLastkajenConfig,
  listPublishedDataPackages,
  pingLastkajen,
  resetLastkajenTokenCache,
} from '../../server/services/lastkajenService';

describe('lastkajenService', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetLastkajenTokenCache();
    vi.restoreAllMocks();
    process.env.LASTKAJEN_USERNAME = 'test-user';
    process.env.LASTKAJEN_PASSWORD = 'test-pass';
    process.env.LASTKAJEN_API_BASE_URL = 'https://lastkajen.example.test';
  });

  afterEach(() => {
    process.env = { ...envBackup };
    resetLastkajenTokenCache();
  });

  it('rapporterar saknad konfiguration', () => {
    delete process.env.LASTKAJEN_USERNAME;
    delete process.env.LASTKAJEN_PASSWORD;
    expect(getLastkajenConfig().configured).toBe(false);
  });

  it('loggar in och listar datapaket', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/Identity/Login')) {
        return new Response(
          JSON.stringify({ access_token: 'tok-abc', expires_in: 3600, is_external: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/DataPackage/GetPublishedDataPackages')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok-abc' });
        return new Response(
          JSON.stringify([{ id: 99, name: 'Bullerdata', published: true }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const packages = await listPublishedDataPackages();
    expect(packages).toHaveLength(1);
    expect(packages[0]?.name).toBe('Bullerdata');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ping returnerar ok när login och katalog fungerar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/Identity/Login')) {
          return new Response(JSON.stringify({ access_token: 'x', expires_in: 60 }), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );

    const result = await pingLastkajen();
    expect(result.ok).toBe(true);
    expect(result.packageCount).toBe(0);
  });
});
