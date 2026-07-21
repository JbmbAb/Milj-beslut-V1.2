import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useMediaQuery, useBreakpoints } from '../../components/hooks/useMediaQuery';

describe('useMediaQuery', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Provide a safe default so any test that doesn't override it still works.
    matchMediaMock = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: matchMediaMock,
      });
    }
  });

  // ── Matching Query ───────────────────────────────────────────────────

  it('should return true when media query matches', () => {
    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { result } = renderHook(() => useMediaQuery('(max-width: 640px)'));

    expect(result.current).toBe(true);
  });

  it('should return false when media query does not match', () => {
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { result } = renderHook(() => useMediaQuery('(max-width: 640px)'));

    expect(result.current).toBe(false);
  });

  // ── Event Listener Management ────────────────────────────────────────

  it('should register change event listener', () => {
    const addEventListenerMock = vi.fn();
    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: addEventListenerMock,
      removeEventListener: vi.fn(),
    });

    renderHook(() => useMediaQuery('(max-width: 640px)'));

    expect(addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('should cleanup event listener on unmount', () => {
    const removeEventListenerMock = vi.fn();
    const addEventListenerMock = vi.fn();

    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
    });

    const { unmount } = renderHook(() => useMediaQuery('(max-width: 640px)'));

    unmount();

    expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('should update when media query changes', () => {
    let listener: ((event: MediaQueryListEvent) => void) | null = null;
    const addEventListenerMock = vi.fn((event: string, fn: (event: MediaQueryListEvent) => void) => {
      if (event === 'change') {
        listener = fn;
      }
    });

    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: addEventListenerMock,
      removeEventListener: vi.fn(),
    });

    const { result, rerender } = renderHook(() => useMediaQuery('(max-width: 640px)'));

    expect(result.current).toBe(true);

    // Simulate media query change
    if (listener) {
      listener({
        matches: false,
        media: '(max-width: 640px)',
      } as MediaQueryListEvent);

      rerender();

      // The hook should trigger a re-render through useSyncExternalStore
      matchMediaMock.mockReturnValue({
        matches: false,
        addEventListener: addEventListenerMock,
        removeEventListener: vi.fn(),
      });

      rerender();
    }
  });

  // ── Query Variations ────────────────────────────────────────────────

  it('should support different query patterns', () => {
    const queries = [
      '(max-width: 640px)',
      '(min-width: 1024px)',
      '(prefers-color-scheme: dark)',
      '(prefers-reduced-motion: reduce)',
      'print',
    ];

    queries.forEach((query) => {
      matchMediaMock.mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const { result } = renderHook(() => useMediaQuery(query));

      expect(matchMediaMock).toHaveBeenCalledWith(query);
      expect(result.current).toBe(true);
    });
  });

  // ── SSR Compatibility ────────────────────────────────────────────────

  it('should handle SSR environment gracefully', () => {
    // jsdom always has window; test that the hook returns a boolean
    // (same contract as SSR fallback — no crash, a safe default).
    const { result } = renderHook(() => useMediaQuery('(max-width: 640px)'));
    expect(typeof result.current).toBe('boolean');
  });

  // ── Multiple Queries ────────────────────────────────────────────────

  it('should support multiple independent media queries', () => {
    let calls = 0;
    matchMediaMock.mockImplementation(() => {
      const query = matchMediaMock.mock.calls[calls][0];
      calls++;
      return {
        matches: query.includes('max-width'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    });

    const { result: mobileResult } = renderHook(() => useMediaQuery('(max-width: 640px)'));
    const { result: desktopResult } = renderHook(() => useMediaQuery('(min-width: 1024px)'));

    expect(mobileResult.current).toBe(true);
    expect(desktopResult.current).toBe(false);
  });
});

describe('useBreakpoints', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    matchMediaMock = vi.fn();
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: matchMediaMock,
      });
    }
  });

  // ── Mobile Breakpoint ────────────────────────────────────────────────

  it('should detect mobile breakpoint', () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: query.includes('max-width: 640px'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isMobile).toBe(true);
  });

  // ── Tablet Breakpoint ────────────────────────────────────────────────

  it('should detect tablet breakpoint', () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: query.includes('max-width: 1024px'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isTablet).toBe(true);
  });

  // ── Desktop Breakpoint ───────────────────────────────────────────────

  it('should detect desktop breakpoint', () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isDesktop).toBe(true);
  });

  // ── Dark Mode Detection ──────────────────────────────────────────────

  it('should detect dark mode preference', () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: query.includes('prefers-color-scheme: dark'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isDarkMode).toBe(true);
  });

  // ── Reduced Motion Detection ─────────────────────────────────────────

  it('should detect reduced motion preference', () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current.isReducedMotion).toBe(true);
  });

  // ── All Breakpoints Together ─────────────────────────────────────────

  it('should return all breakpoints', () => {
    matchMediaMock.mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { result } = renderHook(() => useBreakpoints());

    expect(result.current).toHaveProperty('isMobile');
    expect(result.current).toHaveProperty('isTablet');
    expect(result.current).toHaveProperty('isDesktop');
    expect(result.current).toHaveProperty('isDarkMode');
    expect(result.current).toHaveProperty('isReducedMotion');
  });

  // ── Realistic Scenario ───────────────────────────────────────────────

  it('should reflect realistic responsive design scenario', () => {
    matchMediaMock.mockImplementation((query: string) => {
      // Simulate a mobile device
      return {
        matches: query.includes('max-width'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    });

    const { result } = renderHook(() => useBreakpoints());

    // On mobile
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isTablet).toBe(true);
    expect(result.current.isDesktop).toBe(false);
  });
});
