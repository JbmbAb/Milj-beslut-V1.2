import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Sätt miljövariabler HOISTED så de finns INNAN import
vi.hoisted(() => {
  process.env.TRAFIKVERKET_API_KEY = 'test-api-key';
  process.env.TRAFIKVERKET_API_BASE_URL = 'https://api.test';
});

// 2. Mocka fetch globalt (för att stödja Node-miljöer utan inbyggd fetch)
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { fetchTrafikverketData } from '../../services/trafikverketService';

describe('trafikverketService unit tests', () => {

  beforeEach(() => {
    fetchMock.mockClear();
  });

  it('should call fetch with correct XML body and API key header', async () => {
    const mockSuccessResponse = {
      ok: true,
      json: () => Promise.resolve({
        RESPONSE: {
          RESULT: [{ SomeData: 'success' }]
        }
      })
    };
    fetchMock.mockResolvedValue(mockSuccessResponse);

    const query = '<TEST_QUERY />';
    const result = await fetchTrafikverketData<any>(query);

    expect(fetchMock).toHaveBeenCalledWith('https://api.test', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Trafikverket-Api-Key': 'test-api-key',
        'Content-Type': 'text/xml'
      }),
      body: query
    }));

    expect(result.SomeData).toBe('success');
  });

  it('should throw an error if the API response is not ok', async () => {
    const mockErrorResponse = {
      ok: false,
      status: 500,
      text: () => Promise.resolve('External Server Error')
    };
    fetchMock.mockResolvedValue(mockErrorResponse);

    await expect(fetchTrafikverketData('<ERROR_QUERY />'))
      .rejects.toThrow('API request failed with status 500: External Server Error');
  });

});
