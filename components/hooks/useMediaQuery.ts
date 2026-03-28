import { useSyncExternalStore } from 'react';

/**
 * Hook to detect media query changes
 * Useful for responsive logic without relying only on CSS
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') {
        return () => {};
      }

      const mediaQuery = window.matchMedia(query);
      const listener = () => onStoreChange();

      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    },
    () => (typeof window === 'undefined' ? false : window.matchMedia(query).matches),
    () => false
  );
}

/**
 * Predefined media queries for common breakpoints
 */
export const useBreakpoints = () => ({
  isMobile: useMediaQuery('(max-width: 640px)'),
  isTablet: useMediaQuery('(max-width: 1024px)'),
  isDesktop: useMediaQuery('(min-width: 1024px)'),
  isDarkMode: useMediaQuery('(prefers-color-scheme: dark)'),
  isReducedMotion: useMediaQuery('(prefers-reduced-motion: reduce)'),
});
