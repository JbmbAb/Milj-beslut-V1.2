import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePrevious } from '../../components/hooks/usePrevious';

describe('usePrevious', () => {
  // ── Initial Render ──────────────────────────────────────────────────

  it('should return undefined on initial render', () => {
    const { result } = renderHook(() => usePrevious('initial'));

    expect(result.current).toBeUndefined();
  });

  // ── First Update ────────────────────────────────────────────────────

  it('should return previous value after first update', () => {
    const { result, rerender } = renderHook(({ value }: { value: string }) => usePrevious(value), {
      initialProps: { value: 'first' },
    });

    expect(result.current).toBeUndefined();

    rerender({ value: 'second' });

    expect(result.current).toBe('first');
  });

  // ── Multiple Updates ────────────────────────────────────────────────

  it('should track previous value through multiple updates', () => {
    const { result, rerender } = renderHook(({ value }: { value: string }) => usePrevious(value), {
      initialProps: { value: 'value1' },
    });

    expect(result.current).toBeUndefined();

    rerender({ value: 'value2' });
    expect(result.current).toBe('value1');

    rerender({ value: 'value3' });
    expect(result.current).toBe('value2');

    rerender({ value: 'value4' });
    expect(result.current).toBe('value3');
  });

  // ── Different Data Types ────────────────────────────────────────────

  it('should work with numbers', () => {
    const { result, rerender } = renderHook(({ value }: { value: number }) => usePrevious(value), {
      initialProps: { value: 1 },
    });

    rerender({ value: 2 });
    expect(result.current).toBe(1);

    rerender({ value: 3 });
    expect(result.current).toBe(2);
  });

  it('should work with objects', () => {
    const obj1 = { id: 1, name: 'First' };
    const obj2 = { id: 2, name: 'Second' };
    const obj3 = { id: 3, name: 'Third' };

    const { result, rerender } = renderHook(
      ({ value }: { value: Record<string, unknown> }) => usePrevious(value),
      { initialProps: { value: obj1 } },
    );

    expect(result.current).toBeUndefined();

    rerender({ value: obj2 });
    expect(result.current).toBe(obj1);

    rerender({ value: obj3 });
    expect(result.current).toBe(obj2);
  });

  it('should work with arrays', () => {
    const arr1 = [1, 2, 3];
    const arr2 = [4, 5, 6];
    const arr3 = [7, 8, 9];

    const { result, rerender } = renderHook(({ value }: { value: number[] }) => usePrevious(value), {
      initialProps: { value: arr1 },
    });

    expect(result.current).toBeUndefined();

    rerender({ value: arr2 });
    expect(result.current).toBe(arr1);

    rerender({ value: arr3 });
    expect(result.current).toBe(arr2);
  });

  it('should work with boolean values', () => {
    const { result, rerender } = renderHook(({ value }: { value: boolean }) => usePrevious(value), {
      initialProps: { value: false },
    });

    expect(result.current).toBeUndefined();

    rerender({ value: true });
    expect(result.current).toBe(false);

    rerender({ value: false });
    expect(result.current).toBe(true);
  });

  // ── Null and Undefined ───────────────────────────────────────────────

  it('should handle null values', () => {
    const { result, rerender } = renderHook(({ value }: { value: string | null }) => usePrevious(value), {
      initialProps: { value: 'initial' },
    });

    rerender({ value: null });
    expect(result.current).toBe('initial');

    rerender({ value: 'updated' });
    expect(result.current).toBeNull();
  });

  it('should handle undefined values', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string | undefined }) => usePrevious(value),
      { initialProps: { value: 'initial' } },
    );

    rerender({ value: undefined });
    expect(result.current).toBe('initial');

    rerender({ value: 'updated' });
    expect(result.current).toBeUndefined();
  });

  // ── Stable Reference ────────────────────────────────────────────────

  it('should maintain reference to previous value', () => {
    const obj1 = { id: 1 };
    const obj2 = { id: 2 };

    const { result, rerender } = renderHook(
      ({ value }: { value: Record<string, number> }) => usePrevious(value),
      { initialProps: { value: obj1 } },
    );

    rerender({ value: obj2 });

    // Previous value should be exact same reference
    expect(result.current).toBe(obj1);
    expect(Object.is(result.current, obj1)).toBe(true);
  });

  // ── Type Inference ──────────────────────────────────────────────────

  it('should infer type correctly with generic', () => {
    interface User {
      id: number;
      name: string;
    }

    const user1: User = { id: 1, name: 'Alice' };
    const user2: User = { id: 2, name: 'Bob' };

    const { result, rerender } = renderHook(({ value }: { value: User }) => usePrevious(value), {
      initialProps: { value: user1 },
    });

    rerender({ value: user2 });

    expect(result.current).toEqual({ id: 1, name: 'Alice' });
  });

  // ── Comparison Patterns ──────────────────────────────────────────────

  it('should enable value comparison (prev vs current)', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => {
        const prev = usePrevious(value);
        return { prev, current: value };
      },
      { initialProps: { value: 10 } },
    );

    rerender({ value: 20 });

    expect(result.current.prev).toBe(10);
    expect(result.current.current).toBe(20);
  });

  // ── Real-World Scenario ──────────────────────────────────────────────

  it('should track previous state like in lifecycle use cases', () => {
    const { result, rerender } = renderHook(({ isActive }: { isActive: boolean }) => usePrevious(isActive), {
      initialProps: { isActive: false },
    });

    // Component mounts with isActive=false
    expect(result.current).toBeUndefined();

    // Component becomes active
    rerender({ isActive: true });
    expect(result.current).toBe(false); // Can detect transition

    // Component becomes inactive again
    rerender({ isActive: false });
    expect(result.current).toBe(true); // Can detect transition
  });
});
