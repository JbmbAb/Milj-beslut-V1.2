import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import ApiClient from '../../services/apiClient';

describe('ApiClient', () => {
  let client: ApiClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new ApiClient('https://api.example.com', 5000);
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────

  it('should create instance with default parameters', () => {
    const defaultClient = new ApiClient();
    expect(defaultClient).toBeDefined();
  });

  it('should set base URL in constructor', () => {
    const customClient = new ApiClient('https://custom.api.com');
    expect(customClient).toBeDefined();
  });

  it('should set timeout in constructor', () => {
    const customClient = new ApiClient('https://api.com', 10000);
    expect(customClient).toBeDefined();
  });

  // ── URL Building ─────────────────────────────────────────────────────

  it('should build URL without params', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await client.get('/users');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/users',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should build URL with query parameters', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await client.get('/users', { params: { page: 1, limit: 10 } });

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('page=1'), expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('limit=10'), expect.any(Object));
  });

  it('should skip null/undefined parameters', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await client.get('/users', { params: { page: 1, filter: null, search: undefined } });

    const callUrl = fetchMock.mock.calls[0][0];
    expect(callUrl).toContain('page=1');
    expect(callUrl).not.toContain('filter');
    expect(callUrl).not.toContain('search');
  });

  // ── GET Request ──────────────────────────────────────────────────────

  it('should make successful GET request', async () => {
    const mockData = { id: 1, name: 'Test' };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
    });

    const result = await client.get('/users/1');

    expect(result).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/users/1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should include default headers in GET request', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.get('/users');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  // ── POST Request ─────────────────────────────────────────────────────

  it('should make successful POST request with body', async () => {
    const mockData = { id: 2, name: 'New User' };
    const payload = { name: 'New User' };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => mockData,
    });

    const result = await client.post('/users', payload);

    expect(result).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    );
  });

  it('should POST without body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await client.post('/trigger-action');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: undefined,
      }),
    );
  });

  // ── PATCH Request ────────────────────────────────────────────────────

  it('should make successful PATCH request', async () => {
    const mockData = { id: 1, name: 'Updated' };
    const payload = { name: 'Updated' };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
    });

    const result = await client.patch('/users/1', payload);

    expect(result).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/users/1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    );
  });

  // ── DELETE Request ───────────────────────────────────────────────────

  it('should make successful DELETE request', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });

    await client.delete('/users/1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/users/1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  // ── Error Handling ───────────────────────────────────────────────────

  it('should throw error on non-ok response', async () => {
    const errorData = { error: 'Not found' };
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => errorData,
    });

    await expect(client.get('/users/999')).rejects.toThrow(/HTTP 404/);
  });

  it('should throw error on timeout', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Abort the fetch when the signal fires, simulating real browser abort.
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const promise = client.get('/slow-endpoint', { timeout: 100 });

    await expect(promise).rejects.toThrow(/timeout|abort/i);
  });

  it('should handle network errors', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    await expect(client.get('/users')).rejects.toThrow('Network error');
  });

  it('should handle JSON parse errors gracefully', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    await expect(client.get('/users')).rejects.toThrow('Invalid JSON');
  });

  // ── Request Options ──────────────────────────────────────────────────

  it('should override timeout per request', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const promise = client.get('/endpoint', { timeout: 100 });

    await expect(promise).rejects.toThrow(/timeout|abort/i);
  });

  it('should merge custom headers with defaults', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.get('/users', {
      headers: { Authorization: 'Bearer token123' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123',
        }),
      }),
    );
  });

  // ── setBaseUrl Method ────────────────────────────────────────────────

  it('should update base URL', async () => {
    client.setBaseUrl('https://newapi.example.com');

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.get('/users');

    expect(fetchMock).toHaveBeenCalledWith('https://newapi.example.com/users', expect.any(Object));
  });

  // ── setHeaders Method ────────────────────────────────────────────────

  it('should update default headers', async () => {
    client.setHeaders({ Authorization: 'Bearer token' });

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.get('/users');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        }),
      }),
    );
  });

  it('should merge multiple header updates', async () => {
    client.setHeaders({ Authorization: 'Bearer token' });
    client.setHeaders({ 'X-Custom-Header': 'custom-value' });

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.get('/users');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
          'X-Custom-Header': 'custom-value',
        }),
      }),
    );
  });

  // ── Abort Controller Cleanup ─────────────────────────────────────────

  it('should clear timeout on successful request', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await client.get('/users');

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  it('should clear timeout on error', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    fetchMock.mockRejectedValue(new Error('Network error'));

    try {
      await client.get('/users');
    } catch {
      /* expected */
    }

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  // ── Multiple Requests ────────────────────────────────────────────────

  it('should handle multiple concurrent requests', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 1 }),
    });

    const results = await Promise.all([
      client.get('/users/1'),
      client.get('/users/2'),
      client.get('/users/3'),
    ]);

    expect(results).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // ── Empty Response Body ──────────────────────────────────────────────

  it('should handle empty JSON response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const result = await client.get('/empty');

    expect(result).toEqual({});
  });
});
