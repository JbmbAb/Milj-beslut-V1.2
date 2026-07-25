import { designTokens } from './components/theme/designTokens';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Extend Tailwind's color palette with semantic and brand colors
        ...designTokens.colors.semantic,
        ...designTokens.colors.brand,
        // Integrate toneColors for backgrounds, borders, and text
        // This creates utility classes like `bg-tone-default-bg`, `border-tone-ok-border`, etc.
        'tone-default-bg': designTokens.toneColors.default.bg,
        'tone-default-border': designTokens.toneColors.default.border,
        'tone-default-text': designTokens.toneColors.default.text,
        'tone-ok-bg': designTokens.toneColors.ok.bg,
        'tone-ok-border': designTokens.toneColors.ok.border,
        'tone-ok-text': designTokens.toneColors.ok.text,
        'tone-warn-bg': designTokens.toneColors.warn.bg,
        'tone-warn-border': designTokens.toneColors.warn.border,
        'tone-warn-text': designTokens.toneColors.warn.text,
        'tone-error-bg': designTokens.toneColors.error.bg,
        'tone-error-border': designTokens.toneColors.error.border,
        'tone-error-text': designTokens.toneColors.error.text,
      },
      spacing: designTokens.spacing,
      borderRadius: designTokens.radius,
      fontFamily: designTokens.typography.fontFamily,
      fontSize: designTokens.typography.fontSize,
      fontWeight: designTokens.typography.fontWeight,
      lineHeight: designTokens.typography.lineHeight,
      boxShadow: designTokens.shadow,
      transitionDuration: {
        instant: designTokens.animation.duration.instant,
        fast: designTokens.animation.duration.fast,
        base: designTokens.animation.duration.base,
        slow: designTokens.animation.duration.slow,
        slower: designTokens.animation.duration.slower,
        slowest: designTokens.animation.duration.slowest,
      },
      transitionTimingFunction: {
        linear: designTokens.animation.easing.linear,
        easeIn: designTokens.animation.easing.easeIn,
        easeOut: designTokens.animation.easing.easeOut,
        easeInOut: designTokens.animation.easing.easeInOut,
        spring: designTokens.animation.easing.spring,
      },
      zIndex: designTokens.zIndex,
      screens: designTokens.breakpoints,
    },
  },
  plugins: [],
};
