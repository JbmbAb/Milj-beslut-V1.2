/**
 * Tests för services/weatherService.ts
 * Täcker lyckade och misslyckade HTTP-anrop, felhantering och parameterbyggande.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSmhiWeatherRisk } from '../../services/weatherService';

describe('fetchSmhiWeatherRisk', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returnerar WeatherRisk vid lyckad respons', async () => {
    const mockRisk = { level: 'Låg', description: 'Normalt väder', action: 'Ingen åtgärd' };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: mockRisk }),
    } as any);

    const result = await fetchSmhiWeatherRisk({ lat: 59.33, lng: 18.07 });
    expect(result.level).toBe('Låg');
    expect(result.description).toBe('Normalt väder');
  });

  it('skickar lat och lng som query-parametrar', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { level: 'Medel', description: 'OK', action: 'Planera' } }),
    } as any);

    await fetchSmhiWeatherRisk({ lat: 63.82, lng: 20.26 });

    const callUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(callUrl).toContain('lat=63.82');
    expect(callUrl).toContain('lng=20.26');
  });

  it('skickar municipality som query-parameter om angiven', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: { level: 'Hög', description: 'Storm', action: 'Stoppa schakt' },
      }),
    } as any);

    await fetchSmhiWeatherRisk({ lat: 65, lng: 21, municipality: 'Luleå' });

    const callUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(callUrl).toContain('municipality=Lule%C3%A5');
  });

  it('skickar INTE municipality om den är tom sträng', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { level: 'Låg', description: 'OK', action: 'N/A' } }),
    } as any);

    await fetchSmhiWeatherRisk({ lat: 59, lng: 18, municipality: '' });

    const callUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(callUrl).not.toContain('municipality=');
  });

  it('skickar INTE municipality om den är whitespace', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { level: 'Låg', description: 'OK', action: 'N/A' } }),
    } as any);

    await fetchSmhiWeatherRisk({ lat: 59, lng: 18, municipality: '   ' });

    const callUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(callUrl).not.toContain('municipality=');
  });

  it('kastar fel vid HTTP-fel (response.ok = false)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ ok: false, error: 'Service unavailable' }),
    } as any);

    await expect(fetchSmhiWeatherRisk({ lat: 59, lng: 18 })).rejects.toThrow('Service unavailable');
  });

  it('kastar fel med HTTP-status-kod i meddelande vid JSON-fel', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('JSON parse error');
      },
    } as any);

    await expect(fetchSmhiWeatherRisk({ lat: 59, lng: 18 })).rejects.toThrow(
      'SMHI weather request failed (500)',
    );
  });

  it('kastar fel om payload.ok är false', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: 'Koordinat utanför SMHI-täckning' }),
    } as any);

    await expect(fetchSmhiWeatherRisk({ lat: 0, lng: 0 })).rejects.toThrow('Koordinat utanför SMHI-täckning');
  });

  it('kastar fel om payload.result saknas', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }), // Saknar result
    } as any);

    await expect(fetchSmhiWeatherRisk({ lat: 59, lng: 18 })).rejects.toThrow();
  });

  it('kastar fel om JSON-parse misslyckas för lyckad respons', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => null, // null payload
    } as any);

    await expect(fetchSmhiWeatherRisk({ lat: 59, lng: 18 })).rejects.toThrow();
  });

  it('träffar rätt API-endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { level: 'Låg', description: 'OK', action: 'N/A' } }),
    } as any);

    await fetchSmhiWeatherRisk({ lat: 59, lng: 18 });

    const callUrl = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(callUrl).toContain('/api/weather/smhi-risk');
  });
});
