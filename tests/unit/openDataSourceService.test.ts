import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fsOpen: vi.fn(),
  fsStat: vi.fn(),
}));

vi.mock('node:fs', () => ({
  promises: {
    stat: mocks.fsStat,
    open: mocks.fsOpen,
  },
  // Vite/Vitest sometimes accesses node:fs via a default export interop wrapper.
  default: {
    promises: {
      stat: mocks.fsStat,
      open: mocks.fsOpen,
    },
  },
}));

import { fetchImmediateOpenSources } from '../../server/services/openDataSourceService';

describe('openDataSourceService', () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    LOCAL_DB_ROOT: process.env.LOCAL_DB_ROOT,
    MUNICIPAL_CONTACTS_CSV_PATH: process.env.MUNICIPAL_CONTACTS_CSV_PATH,
    MUNICIPAL_DIARIES_INDEX_URL: process.env.MUNICIPAL_DIARIES_INDEX_URL,
    TRAFIKVERKET_API_BASE_URL: process.env.TRAFIKVERKET_API_BASE_URL,
    TRAFIKVERKET_API_KEY: process.env.TRAFIKVERKET_API_KEY,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOCAL_DB_ROOT;
    delete process.env.MUNICIPAL_CONTACTS_CSV_PATH;
    delete process.env.MUNICIPAL_DIARIES_INDEX_URL;
    delete process.env.TRAFIKVERKET_API_BASE_URL;
    delete process.env.TRAFIKVERKET_API_KEY;

    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('api.scb.se')) {
        return {
          ok: true,
          status: 200,
          text: async () => '{"tables":["table-1"]}',
        } as Response;
      }

      if (url.includes('trafikinfo.trafikverket.se')) {
        return {
          ok: true,
          status: 200,
          text: async () => '{"RESPONSE":"ok"}',
        } as Response;
      }

      if (url.includes('diaries.example.test')) {
        return {
          ok: true,
          status: 200,
          text: async () => '<html>diary index</html>',
        } as Response;
      }

      if (url.includes('havochvatten.se')) {
        throw new Error('HAV offline');
      }

      expect(init?.method).toMatch(/GET|POST/);
      return {
        ok: true,
        status: 200,
        text: async () => 'ok',
      } as Response;
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key as keyof typeof originalEnv];
      else process.env[key as keyof typeof originalEnv] = value;
    }
  });

  it('reports missing optional credentials and local source paths', async () => {
    const result = await fetchImmediateOpenSources();

    expect(result).toHaveLength(15);
    expect(result.find((row) => row.source === 'trafikverket')).toMatchObject({
      ok: false,
      details: expect.stringContaining('TRAFIKVERKET_API_KEY'),
    });
    expect(result.find((row) => row.source === 'kommun_kontakter_csv')).toMatchObject({
      ok: false,
      details: expect.stringContaining('MUNICIPAL_CONTACTS_CSV_PATH'),
    });
    expect(result.find((row) => row.source === 'kommunala_diarier')).toMatchObject({
      ok: false,
      details: expect.stringContaining('MUNICIPAL_DIARIES_INDEX_URL'),
    });
    expect(result.find((row) => row.source === 'lantmateriet_open_ftp')).toMatchObject({
      ok: true,
      status: 200,
    });
  });

  it('uses LOCAL_DB_ROOT to resolve csv path when MUNICIPAL_CONTACTS_CSV_PATH not set', async () => {
    process.env.LOCAL_DB_ROOT = 'C:/data/local';

    mocks.fsStat.mockResolvedValueOnce({ size: 256 });
    const handle = {
      read: vi.fn(async (buffer: Buffer) => {
        const content = Buffer.from('kommun;telefon\nGävle;026-17 80 00');
        content.copy(buffer, 0);
        return { bytesRead: content.length };
      }),
      close: vi.fn(async () => undefined),
    };
    mocks.fsOpen.mockResolvedValueOnce(handle);

    const result = await fetchImmediateOpenSources();

    const csv = result.find((row) => row.source === 'kommun_kontakter_csv');
    expect(csv).toBeDefined();
    // Windows normalizes forward-slash paths to backslash; compare case-insensitively.
    expect(csv?.endpoint.replace(/\\/g, '/')).toContain('C:/data/local');
    expect(csv?.ok).toBe(true);
  });

  it('returns failed result when CSV stat throws', async () => {
    process.env.MUNICIPAL_CONTACTS_CSV_PATH = 'C:/data/missing.csv';
    mocks.fsStat.mockRejectedValueOnce(new Error('ENOENT: no such file'));

    const result = await fetchImmediateOpenSources();

    const csv = result.find((row) => row.source === 'kommun_kontakter_csv');
    expect(csv).toBeDefined();
    expect(csv?.ok).toBe(false);
    expect(csv?.details).toContain('ENOENT');
  });

  it('marks trafikverket failed when API returns non-ok response', async () => {
    process.env.TRAFIKVERKET_API_KEY = 'bad-key';
    process.env.TRAFIKVERKET_API_BASE_URL = 'https://trafikinfo.trafikverket.se/v2/data.json';

    // Override trafikverket fetch to return 401
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('trafikinfo.trafikverket.se')) {
        return {
          ok: false,
          status: 401,
          text: async () => '{"RESPONSE":"Unauthorized"}',
        } as Response;
      }
      return { ok: true, status: 200, text: async () => 'ok' } as Response;
    });

    const result = await fetchImmediateOpenSources();

    const trafik = result.find((row) => row.source === 'trafikverket');
    expect(trafik).toBeDefined();
    expect(trafik?.ok).toBe(false);
    expect(trafik?.status).toBe(401);
  });
});
