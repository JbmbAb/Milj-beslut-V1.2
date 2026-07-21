import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useDebounce } from '../../components/hooks/useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial State ────────────────────────────────────────────────────

  it('should return initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('test', 500));

    expect(result.current).toBe('test');
  });

  // ── Debouncing Behavior ──────────────────────────────────────────────

  it('should delay update by specified delay time', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 500 } },
    );

    expect(result.current).toBe('initial');

    rerender({ value: 'updated', delay: 500 });

    // Value should not have changed yet
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('updated');
  });

  it('should reset delay timer on value change', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'value1', delay: 500 } },
    );

    rerender({ value: 'value2', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(result.current).toBe('value1');

    // Change value again – should reset timer
    rerender({ value: 'value3', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(result.current).toBe('value1');

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe('value3');
  });

  // ── Default Delay ───────────────────────────────────────────────────

  it('should use 500ms as default delay', () => {
    const { result, rerender } = renderHook(({ value }: { value: string }) => useDebounce(value), {
      initialProps: { value: 'initial' },
    });

    rerender({ value: 'updated' });

    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe('updated');
  });

  // ── Delay Changes ────────────────────────────────────────────────────

  it('should respect delay changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 500 } },
    );

    rerender({ value: 'updated', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe('initial');

    // Reduce delay – a new 200ms timer starts from this point.
    rerender({ value: 'updated', delay: 200 });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toBe('updated');
  });

  // ── Multiple Values ──────────────────────────────────────────────────

  it('should debounce multiple sequential value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'value1', delay: 500 } },
    );

    rerender({ value: 'value2', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ value: 'value3', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    rerender({ value: 'value4', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Still on original value
    expect(result.current).toBe('value1');

    // Advance enough to fire the last 500ms timer (started at T=200, fires at T=700; we're at T=300 → need 400ms+)
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Should now have the latest value
    expect(result.current).toBe('value4');
  });

  // ── Different Data Types ─────────────────────────────────────────────

  it('should work with numbers', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: number; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 1, delay: 500 } },
    );

    expect(result.current).toBe(1);

    rerender({ value: 2, delay: 500 });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toBe(2);
  });

  it('should work with objects', () => {
    const obj1 = { name: 'obj1' };
    const obj2 = { name: 'obj2' };

    const { result, rerender } = renderHook(
      ({ value, delay }: { value: Record<string, string>; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: obj1, delay: 500 } },
    );

    expect(result.current).toBe(obj1);

    rerender({ value: obj2, delay: 500 });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toBe(obj2);
  });

  it('should work with arrays', () => {
    const arr1 = [1, 2, 3];
    const arr2 = [4, 5, 6];

    const { result, rerender } = renderHook(
      ({ value, delay }: { value: number[]; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: arr1, delay: 500 } },
    );

    expect(result.current).toBe(arr1);

    rerender({ value: arr2, delay: 500 });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toBe(arr2);
  });

  // ── Zero Delay ───────────────────────────────────────────────────────

  it('should update immediately with zero delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 0 } },
    );

    rerender({ value: 'updated', delay: 0 });
    act(() => {
      vi.runAllTimers();
    });

    expect(result.current).toBe('updated');
  });

  // ── Cleanup ──────────────────────────────────────────────────────────

  it('should cleanup timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const { unmount, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 500 } },
    );

    rerender({ value: 'updated', delay: 500 });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });

  // ── Search Scenario ──────────────────────────────────────────────────

  it('should debounce search input as expected', () => {
    const searchTerms = ['a', 'ab', 'abc', 'abcd'];
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: '', delay: 300 } },
    );

    // Simulate user typing – each keystroke advances 100ms (less than 300ms delay)
    searchTerms.forEach((term) => {
      rerender({ value: term, delay: 300 });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    });

    // After 100ms of last keystroke, value should still be the pre-typing value
    expect(result.current).toBe('');

    // Wait for debounce to complete
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Now should have final value
    expect(result.current).toBe('abcd');
  });

  // ── Fast Changes ─────────────────────────────────────────────────────

  it('should only update after debounce completes with rapid changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 500 } },
    );

    for (let i = 1; i <= 10; i++) {
      rerender({ value: `value${i}`, delay: 500 });
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }

    // Should still be on initial
    expect(result.current).toBe('initial');

    // Wait for debounce
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Should be on final value
    expect(result.current).toBe('value10');
  });
});
