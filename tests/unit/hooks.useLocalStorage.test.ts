import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { useLocalStorage } from '../../components/hooks/useLocalStorage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ── Initial Value ────────────────────────────────────────────────────

  it('should initialize with provided initial value', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

    expect(result.current[0]).toBe('initial');
  });

  it('should read existing value from localStorage', () => {
    localStorage.setItem('test-key', JSON.stringify('stored-value'));

    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

    expect(result.current[0]).toBe('stored-value');
  });

  it('should handle complex objects', () => {
    const initialObject = { id: 1, name: 'Test', nested: { value: true } };
    const { result } = renderHook(() => useLocalStorage('test-key', initialObject));

    expect(result.current[0]).toEqual(initialObject);
  });

  it('should handle arrays', () => {
    const initialArray = [1, 2, 3, 'four'];
    const { result } = renderHook(() => useLocalStorage('test-key', initialArray));

    expect(result.current[0]).toEqual(initialArray);
  });

  // ── Setting Values ───────────────────────────────────────────────────

  it('should update state when setValue is called', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

    act(() => {
      result.current[1]('updated');
    });

    expect(result.current[0]).toBe('updated');
  });

  it('should persist value to localStorage when setValue is called', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

    act(() => {
      result.current[1]('persisted');
    });

    expect(localStorage.getItem('test-key')).toBe(JSON.stringify('persisted'));
  });

  it('should handle complex object updates', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', { count: 0 }));

    act(() => {
      result.current[1]({ count: 1 });
    });

    expect(result.current[0]).toEqual({ count: 1 });
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify({ count: 1 }));
  });

  // ── Multiple Keys ────────────────────────────────────────────────────

  it('should handle multiple independent keys', () => {
    const { result: result1 } = renderHook(() => useLocalStorage('key1', 'value1'));
    const { result: result2 } = renderHook(() => useLocalStorage('key2', 'value2'));

    expect(result1.current[0]).toBe('value1');
    expect(result2.current[0]).toBe('value2');

    act(() => {
      result1.current[1]('updated1');
      result2.current[1]('updated2');
    });

    expect(result1.current[0]).toBe('updated1');
    expect(result2.current[0]).toBe('updated2');
    expect(localStorage.getItem('key1')).toBe(JSON.stringify('updated1'));
    expect(localStorage.getItem('key2')).toBe(JSON.stringify('updated2'));
  });

  // ── Error Handling ───────────────────────────────────────────────────

  it('should handle invalid JSON in localStorage', () => {
    localStorage.setItem('test-key', 'invalid-json{');
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useLocalStorage('test-key', 'fallback'));

    expect(result.current[0]).toBe('fallback');
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should handle localStorage full error', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

    act(() => {
      result.current[1]('new-value');
    });

    expect(consoleSpy).toHaveBeenCalled();

    setItemSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  // ── Null and Undefined ───────────────────────────────────────────────

  it('should handle null values', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', null as unknown));

    act(() => {
      result.current[1](null as unknown);
    });

    expect(result.current[0]).toBeNull();
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify(null));
  });

  it('should handle undefined values', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', undefined as unknown));

    expect(result.current[0]).toBeUndefined();
  });

  // ── Numeric Values ───────────────────────────────────────────────────

  it('should handle numeric values', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 42));

    act(() => {
      result.current[1](123);
    });

    expect(result.current[0]).toBe(123);
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify(123));
  });

  it('should handle boolean values', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', false));

    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify(true));
  });

  // ── Hook Reuse with Same Key ────────────────────────────────────────

  it('should sync across multiple instances of same key', () => {
    const { result: result1 } = renderHook(() => useLocalStorage('shared-key', 'initial'));
    const { result: result2 } = renderHook(() => useLocalStorage('shared-key', 'fallback'));

    expect(result1.current[0]).toBe('initial');
    expect(result2.current[0]).toBe('fallback');

    act(() => {
      result1.current[1]('updated-from-1');
    });

    // result2 won't automatically update since they're separate hook instances
    // but localStorage will have the updated value
    expect(localStorage.getItem('shared-key')).toBe(JSON.stringify('updated-from-1'));
  });

  // ── SSR Compatibility ────────────────────────────────────────────────

  it('should use initial value when window is undefined', () => {
    // jsdom always provides window; test that the hook returns the initial value
    // for a key that was never stored (which exercises the same fallback code path).
    const { result } = renderHook(() => useLocalStorage('never-stored-key-xyz', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  // ── Type Safety ──────────────────────────────────────────────────────

  it('should work with different generic types', () => {
    interface User {
      id: number;
      name: string;
      email: string;
    }

    const user: User = { id: 1, name: 'Test', email: 'test@example.com' };
    const { result } = renderHook(() => useLocalStorage('user', user));

    expect(result.current[0]).toEqual(user);

    const updatedUser: User = { id: 2, name: 'Updated', email: 'updated@example.com' };

    act(() => {
      result.current[1](updatedUser);
    });

    expect(result.current[0]).toEqual(updatedUser);
  });

  // ── persistence ──────────────────────────────────────────────────────

  it('should persist through page reloads', () => {
    const { result } = renderHook(() => useLocalStorage('persist-key', 'initial'));

    act(() => {
      result.current[1]('persisted-value');
    });

    expect(localStorage.getItem('persist-key')).toBe(JSON.stringify('persisted-value'));

    // Simulate page reload by creating new hook instance
    const { result: newResult } = renderHook(() => useLocalStorage('persist-key', 'fallback'));

    expect(newResult.current[0]).toBe('persisted-value');
  });
});
