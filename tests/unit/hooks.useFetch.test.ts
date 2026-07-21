import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useFetch } from '../../components/hooks/useFetch';

describe('useFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Initial State ────────────────────────────────────────────────────

  it('should start with loading=true and data=null', () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    const { result } = renderHook(() => useFetch('https://api.example.com/users'));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // ── Successful Fetch ─────────────────────────────────────────────────

  it('should fetch and set data on successful response', async () => {
    const mockData = { id: 1, name: 'Test User' };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const { result } = renderHook(() => useFetch('https://api.example.com/users'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
  });

  it('should call fetch with correct URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const url = 'https://api.example.com/users/123';
    renderHook(() => useFetch(url));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(url, undefined);
    });
  });

  it('should pass options to fetch', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const options = { headers: { Authorization: 'Bearer token' } };
    renderHook(() => useFetch('https://api.example.com/users', options));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/users', options);
    });
  });

  // ── Error Handling ───────────────────────────────────────────────────

  it('should set error on non-ok response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const { result } = renderHook(() => useFetch('https://api.example.com/notfound'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error?.message).toBe('HTTP 404');
    });

    expect(result.current.data).toBeNull();
  });

  it('should handle network errors', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFetch('https://api.example.com/users'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error?.message).toBe('Network error');
    });

    expect(result.current.data).toBeNull();
  });

  it('should convert non-Error objects to Error', async () => {
    fetchMock.mockRejectedValue('string error');

    const { result } = renderHook(() => useFetch('https://api.example.com/users'));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    // Hook wraps non-Error values in new Error('Unknown error').
    expect(result.current.error).toBeInstanceOf(Error);
  });

  // ── Null URL ─────────────────────────────────────────────────────────

  it('should not fetch when URL is null', () => {
    const { result } = renderHook(() => useFetch(null));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should clear state when URL changes to null', async () => {
    const mockData = { id: 1 };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const { result, rerender } = renderHook(({ url }: { url: string | null }) => useFetch(url), {
      initialProps: { url: 'https://api.example.com/users' },
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockData);
    });

    rerender({ url: null });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  // ── Refetch Function ─────────────────────────────────────────────────

  it('should expose refetch function', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    const { result } = renderHook(() => useFetch('https://api.example.com/users'));

    expect(typeof result.current.refetch).toBe('function');
  });

  it('should refetch data when refetch is called', async () => {
    const mockData = { id: 1 };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const { result } = renderHook(() => useFetch('https://api.example.com/users'));

    await waitFor(() => {
      expect(result.current.data).toEqual(mockData);
    });

    const initialCallCount = fetchMock.mock.calls.length;

    await result.current.refetch();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  it('should update loading state during refetch', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    const { result } = renderHook(() => useFetch('https://api.example.com/users'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual({ id: 1 });

    // Trigger refetch and await it
    await result.current.refetch();

    // After refetch completes, should not be loading and data should remain
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ id: 1 });
  });

  // ── URL Changes ──────────────────────────────────────────────────────

  it('should refetch when URL changes', async () => {
    const mockData1 = { id: 1 };
    const mockData2 = { id: 2 };

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockData1,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockData2,
      });

    const { result, rerender } = renderHook(({ url }: { url: string }) => useFetch(url), {
      initialProps: { url: 'https://api.example.com/users/1' },
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockData1);
    });

    rerender({ url: 'https://api.example.com/users/2' });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockData2);
    });
  });

  // ── Generic Types ────────────────────────────────────────────────────

  it('should work with different response types', async () => {
    const stringFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => 'string data',
    });

    const numberFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => 42,
    });

    const arrayFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [1, 2, 3],
    });

    global.fetch = stringFetch;
    const { result: stringResult } = renderHook(() => useFetch('https://api.example.com/string'));

    global.fetch = numberFetch;
    const { result: numberResult } = renderHook(() => useFetch('https://api.example.com/number'));

    global.fetch = arrayFetch;
    const { result: arrayResult } = renderHook(() => useFetch('https://api.example.com/array'));

    await waitFor(() => {
      expect(stringResult.current.data).toBe('string data');
      expect(numberResult.current.data).toBe(42);
      expect(arrayResult.current.data).toEqual([1, 2, 3]);
    });
  });

  // ── Multiple Fetches ────────────────────────────────────────────────

  it('should handle rapid URL changes', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    const { rerender } = renderHook(({ url }: { url: string }) => useFetch(url), {
      initialProps: { url: 'https://api.example.com/1' },
    });

    rerender({ url: 'https://api.example.com/2' });
    rerender({ url: 'https://api.example.com/3' });

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    });
  });

  // ── Options Changes ──────────────────────────────────────────────────

  it('should refetch when options change', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    const { rerender } = renderHook(({ options }) => useFetch('https://api.example.com/users', options), {
      initialProps: { options: undefined },
    });

    const initialCallCount = fetchMock.mock.calls.length;

    rerender({ options: { headers: { Authorization: 'Bearer token' } } });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCallCount);
  });
});
