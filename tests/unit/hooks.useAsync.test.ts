import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsync } from '../../components/hooks/useAsync';

describe('useAsync', () => {
  // ── Immediate Execution ──────────────────────────────────────────────

  it('should execute async function immediately when immediate=true', async () => {
    const asyncFn = vi.fn().mockResolvedValue('data');

    renderHook(() => useAsync(asyncFn, true));

    await waitFor(() => {
      expect(asyncFn).toHaveBeenCalled();
    });
  });

  it('should not execute async function when immediate=false', async () => {
    const asyncFn = vi.fn().mockResolvedValue('data');

    renderHook(() => useAsync(asyncFn, false));

    expect(asyncFn).not.toHaveBeenCalled();
  });

  // ── Status States ────────────────────────────────────────────────────

  it('should start with idle status', () => {
    const asyncFn = vi.fn().mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useAsync(asyncFn, false));

    expect(result.current.status).toBe('idle');
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should transition to pending then success on successful execution', async () => {
    const asyncFn = vi.fn().mockResolvedValue({ id: 1, name: 'Test' });

    const { result } = renderHook(() => useAsync(asyncFn, false));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.status).toBe('success');
    expect(result.current.data).toEqual({ id: 1, name: 'Test' });
    expect(result.current.error).toBeNull();
  });

  it('should transition to pending then error on failed execution', async () => {
    const testError = new Error('Test error');
    const asyncFn = vi.fn().mockRejectedValue(testError);

    const { result } = renderHook(() => useAsync(asyncFn, false));

    await act(async () => {
      try {
        await result.current.execute();
      } catch {
        /* expected */
      }
    });

    expect(result.current.status).toBe('error');
    expect(result.current.data).toBeNull();
    expect(result.current.error).toEqual(testError);
  });

  // ── Execute Function ────────────────────────────────────────────────

  it('should expose execute function to manually trigger async operation', async () => {
    const asyncFn = vi.fn().mockResolvedValue('manual-data');

    const { result } = renderHook(() => useAsync(asyncFn, false));

    expect(result.current.execute).toBeDefined();

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe('manual-data');
  });

  it('should reset state before executing', async () => {
    const asyncFn = vi.fn().mockResolvedValue('new-data');

    const { result } = renderHook(() => useAsync(asyncFn, false));

    // First execution
    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe('new-data');

    // Second execution should reset
    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe('new-data');
  });

  it('should return promise from execute function', async () => {
    const expectedData = { id: 1 };
    const asyncFn = vi.fn().mockResolvedValue(expectedData);

    const { result } = renderHook(() => useAsync(asyncFn, false));

    let executeResult: any = null;

    await act(async () => {
      executeResult = await result.current.execute();
    });

    expect(executeResult).toEqual(expectedData);
  });

  it('should throw error from execute function', async () => {
    const testError = new Error('Execution failed');
    const asyncFn = vi.fn().mockRejectedValue(testError);

    const { result } = renderHook(() => useAsync(asyncFn, false));

    let caughtError: Error | null = null;

    await act(async () => {
      try {
        await result.current.execute();
      } catch (error) {
        caughtError = error as Error;
      }
    });

    expect(caughtError).toEqual(testError);
  });

  // ── Error Handling ───────────────────────────────────────────────────

  it('should convert non-Error objects to Error', async () => {
    const asyncFn = vi.fn().mockRejectedValue('string error');

    const { result } = renderHook(() => useAsync(asyncFn, false));

    await act(async () => {
      try {
        await result.current.execute();
      } catch {
        /* expected */
      }
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('string error');
  });

  // ── Multiple Executions ──────────────────────────────────────────────

  it('should handle multiple sequential executions', async () => {
    const asyncFn = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')
      .mockResolvedValueOnce('third');

    const { result } = renderHook(() => useAsync(asyncFn, false));

    // First execution
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.data).toBe('first');

    // Second execution
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.data).toBe('second');

    // Third execution
    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.data).toBe('third');
  });

  // ── Dependency Updates ───────────────────────────────────────────────

  it('should update execute function when asyncFunction changes', async () => {
    const asyncFn1 = vi.fn().mockResolvedValue('data1');
    const asyncFn2 = vi.fn().mockResolvedValue('data2');

    const { result, rerender } = renderHook(({ fn }: { fn: () => Promise<string> }) => useAsync(fn, false), {
      initialProps: { fn: asyncFn1 },
    });

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe('data1');

    // Change the async function
    rerender({ fn: asyncFn2 });

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe('data2');
  });

  // ── Immediate Flag ───────────────────────────────────────────────────

  it('should respect immediate flag changes', async () => {
    const asyncFn = vi.fn().mockResolvedValue('auto-data');

    const { rerender } = renderHook(({ immediate }: { immediate: boolean }) => useAsync(asyncFn, immediate), {
      initialProps: { immediate: false },
    });

    expect(asyncFn).not.toHaveBeenCalled();

    rerender({ immediate: true });

    await waitFor(() => {
      expect(asyncFn).toHaveBeenCalled();
    });
  });

  // ── Cleanup ──────────────────────────────────────────────────────────

  it('should handle rapid successive executions', async () => {
    const asyncFn = vi.fn().mockResolvedValue('data');

    const { result } = renderHook(() => useAsync(asyncFn, false));

    await act(async () => {
      await Promise.all([result.current.execute(), result.current.execute(), result.current.execute()]);
    });

    expect(result.current.data).toBe('data');
  });

  // ── Generic Types ────────────────────────────────────────────────────

  it('should work with different data types', async () => {
    const asyncFnString = vi.fn().mockResolvedValue('string');
    const asyncFnNumber = vi.fn().mockResolvedValue(42);
    const asyncFnObject = vi.fn().mockResolvedValue({ key: 'value' });

    const { result: stringResult } = renderHook(() => useAsync(asyncFnString, false));
    const { result: numberResult } = renderHook(() => useAsync(asyncFnNumber, false));
    const { result: objectResult } = renderHook(() => useAsync(asyncFnObject, false));

    await act(async () => {
      await stringResult.current.execute();
      await numberResult.current.execute();
      await objectResult.current.execute();
    });

    expect(stringResult.current.data).toBe('string');
    expect(numberResult.current.data).toBe(42);
    expect(objectResult.current.data).toEqual({ key: 'value' });
  });
});
