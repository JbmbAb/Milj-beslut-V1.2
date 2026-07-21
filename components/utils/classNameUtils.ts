/**
 * Utility functions for className composition and manipulation
 */

/**
 * Merge multiple className strings intelligently
 * Useful for combining base classes with conditional overrides
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter((c) => typeof c === 'string' && c.length > 0).join(' ');
}

/**
 * Create tone-based className patterns
 * Ensures consistency across components using tone system
 */
export const toneClassNames = {
  default: 'border-slate-200 bg-slate-50 text-slate-800',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-800',
} as const;

/**
 * Generate responsive className for common patterns
 */
export const responsiveClasses = {
  grid2Col: 'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6',
  gridAuto: 'grid grid-cols-1 gap-4 lg:grid-cols-2',
  flexCenterY: 'flex items-center gap-3',
  flexStart: 'flex flex-col gap-4 md:flex-row md:items-end md:justify-between',
} as const;
