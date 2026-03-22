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

  it('checks trafikverket, local csv previews and diary index sources', async () => {
    process.env.TRAFIKVERKET_API_KEY = 'trafik-key';
    process.env.TRAFIKVERKET_API_BASE_URL = 'https://trafikinfo.trafikverket.se/v2/data.json';
    process.env.MUNICIPAL_CONTACTS_CSV_PATH = 'C:/data/kommuner.csv';
    process.env.MUNICIPAL_DIARIES_INDEX_URL = 'https://diaries.example.test';

    const handle = {
      read: vi.fn(async (buffer: Buffer) => {
        const content = Buffer.from('kommun;telefon\nOrsa;0123-45 67 89');
        content.copy(buffer, 0);
        return { bytesRead: content.length };
      }),
      close: vi.fn(async () => undefined),
    };

    mocks.fsStat.mockResolvedValueOnce({ size: 128 });
    mocks.fsOpen.mockResolvedValueOnce(handle);

    const result = await fetchImmediateOpenSources();

    expect(result.find((row) => row.source === 'trafikverket')).toMatchObject({
      ok: true,
      status: 200,
      sample: { RESPONSE: 'ok' },
    });
    expect(result.find((row) => row.source === 'kommun_kontakter_csv')).toMatchObject({
      ok: true,
      status: 200,
      endpoint: 'C:/data/kommuner.csv',
      sample: {
        sizeBytes: 128,
        preview: expect.stringContaining('Orsa'),
      },
    });
    expect(result.find((row) => row.source === 'kommunala_diarier')).toMatchObject({
      ok: true,
      status: 200,
      endpoint: 'https://diaries.example.test',
    });
    expect(result.find((row) => row.source === 'hav')).toMatchObject({
      ok: false,
      details: 'HAV offline',
    });
    expect(handle.close).toHaveBeenCalled();
  });
});
