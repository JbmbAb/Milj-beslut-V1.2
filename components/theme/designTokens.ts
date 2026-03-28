/**
 * Centralized Design Token System
 * Single source of truth for colors, spacing, typography, shadows, and animations
 * Replaces scattered hardcoded values throughout the codebase
 */

export const designTokens = {
  // Color Palette
  colors: {
    // Dark theme (primary)
    dark: {
      bg: '#060607',
      bgGradientEnd: '#0a0a0d',
      surface: '#0F0F11',
      border: 'rgba(255, 255, 255, 0.05)',
      borderLight: 'rgba(255, 255, 255, 0.1)',
      text: '#ffffff',
      textSecondary: '#94a3b8',
      textTertiary: '#64748b',
    },

    // Light theme
    light: {
      bg: '#ffffff',
      surface: '#f8fafc',
      border: 'rgba(2, 8, 23, 0.1)',
      borderLight: 'rgba(2, 8, 23, 0.05)',
      text: '#0f172a',
      textSecondary: '#64748b',
      textTertiary: '#94a3b8',
    },

    // Semantic colors
    semantic: {
      primary: '#6366f1',      // indigo-500
      primaryHover: '#4f46e5', // indigo-600
      success: '#10b981',      // emerald-500
      warning: '#f59e0b',      // amber-500
      error: '#ef4444',        // red-500
      info: '#3b82f6',         // blue-500
    },

    // Brand colors
    brand: {
      emerald: '#10b981',
      indigo: '#6366f1',
      teal: '#14b8a6',
      amber: '#f59e0b',
      rose: '#f43f5e',
      fuchsia: '#d946ef',
    },
  },

  // Spacing Scale (8px base unit)
  spacing: {
    xs: '4px',    // 0.5 * base
    sm: '8px',    // 1 * base
    md: '12px',   // 1.5 * base
    lg: '16px',   // 2 * base
    xl: '24px',   // 3 * base
    '2xl': '32px', // 4 * base
    '3xl': '48px', // 6 * base
    '4xl': '64px', // 8 * base
  },

  // Border Radius
  radius: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '28px',
    '4xl': '32px',
    full: '9999px',
  },

  // Typography
  typography: {
    fontFamily: {
      base: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      heading: '"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      mono: '"Lucida Sans Typewriter", monospace',
    },
    fontSize: {
      xs: '12px',
      sm: '14px',
      base: '16px',
      lg: '18px',
      xl: '20px',
      '2xl': '24px',
      '3xl': '30px',
      '4xl': '36px',
      '5xl': '48px',
      '6xl': '60px',
    },
    fontWeight: {
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      black: 900,
    },
    lineHeight: {
      tight: 1.2,
      snug: 1.375,
      normal: 1.5,
      relaxed: 1.625,
      loose: 2,
    },
  },

  // Shadows
  shadow: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
    '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    dark: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
    glow: {
      emerald: 'shadow-lg shadow-emerald-600/20',
      indigo: 'shadow-lg shadow-indigo-600/20',
      teal: 'shadow-lg shadow-teal-600/20',
      rose: 'shadow-lg shadow-rose-600/20',
    },
  },

  // Animations & Transitions
  animation: {
    duration: {
      instant: '0s',
      fast: '150ms',
      base: '200ms',
      slow: '300ms',
      slower: '500ms',
      slowest: '1000ms',
    },
    easing: {
      linear: 'linear',
      easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
      easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
      easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
      spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    },
  },

  // Z-index Scale
  zIndex: {
    hide: -1,
    base: 0,
    dropdown: 1000,
    sticky: 1020,
    fixed: 1030,
    backdrop: 1040,
    offCanvas: 1050,
    modal: 1060,
    popover: 1070,
    tooltip: 1080,
  },

  // Breakpoints
  breakpoints: {
    xs: '320px',
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },
} as const;

// Tone/Status colors for badge and alert components
export const toneColors = {
  default: {
    border: 'rgba(226, 232, 240, 0.2)',
    bg: 'rgba(226, 232, 240, 0.1)',
    text: '#e2e8f0',
  },
  ok: {
    border: '#a7f3d0',
    bg: '#ecfdf5',
    text: '#065f46',
  },
  warn: {
    border: '#fcd34d',
    bg: '#fffbeb',
    text: '#92400e',
  },
  error: {
    border: '#fca5a5',
    bg: '#fef2f2',
    text: '#7f1d1d',
  },
} as const;

// Export type for TypeScript usage
export type DesignTokens = typeof designTokens;
export type ToneColor = keyof typeof toneColors;
