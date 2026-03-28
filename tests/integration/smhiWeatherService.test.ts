import { describe, it, expect, beforeEach } from 'vitest';
import { getSmhiWeatherRisk, clearSmhiWeatherCache } from '../../server/services/smhiWeatherService';

describe('smhiWeatherService Integration (Real SMHI API)', () => {
  beforeEach(() => {
    clearSmhiWeatherCache();
  });

  it('should fetch real-time weather risk for Stockholm (WGS84)', async () => {
    const lat = 59.3293;
    const lng = 18.0686;
    const municipality = 'Stockholm';

    const result = await getSmhiWeatherRisk({ lat, lng, municipality });

    // Verifiera att vi får ett strukturerat svar
    expect(result).toBeDefined();
    expect(result.source).toBe('smhi_pmp3g');
    expect(result.coordinates.lat).toBeCloseTo(lat, 4);
    expect(result.coordinates.lng).toBeCloseTo(lng, 4);

    // Verifiera att vi har en tidslinje (minst 1 timme)
    expect(result.timeline.length).toBeGreaterThan(0);
    expect(result.timeline[0].validTime).toBeDefined();

    // Verifiera svenska texter
    expect(['Låg', 'Medel', 'Hög']).toContain(result.level);
    expect(result.description).toContain('SMHI-prognosen för Stockholm visar');
    expect(result.action).toBeDefined();

    console.log(`Current Weather in Stockholm: ${result.level} risk. Summary: ${result.description}`);
  });

  it('should fetch weather for a northern location (Orsa) and handle Swedish characters', async () => {
    const lat = 61.1219;
    const lng = 14.6154;
    const municipality = 'Orsa';

    const result = await getSmhiWeatherRisk({ lat, lng, municipality });

    expect(result.municipality).toBe('Orsa');
    expect(result.description).toContain('för Orsa visar');
    expect(result.summary.airTemperatureC).toBeTypeOf('number');
  });

  it('should use cache for subsequent requests to the same location', async () => {
    const coords = { lat: 57.7089, lng: 11.9746, municipality: 'Göteborg' };

    const start1 = Date.now();
    const res1 = await getSmhiWeatherRisk(coords);
    const duration1 = Date.now() - start1;

    const start2 = Date.now();
    const res2 = await getSmhiWeatherRisk(coords);
    const duration2 = Date.now() - start2;

    expect(res2).toEqual(res1);
    // Cachen bör vara betydligt snabbare än ett nätverksanrop
    expect(duration2).toBeLessThan(duration1);
    console.log(`Cache hit saved approx ${duration1 - duration2}ms`);
  });

  it('should throw Error for invalid coordinates (SMHI returning 400)', async () => {
    // SMHI brukar returnera 400 ifall man skickar koordinater utanför deras täckningsområde (vissa versioner)
    // eller om de är helt absurda.
    const invalidCoords = { lat: 500, lng: 500 };

    await expect(getSmhiWeatherRisk(invalidCoords)).rejects.toThrow();
  });
});
