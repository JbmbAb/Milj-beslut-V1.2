import React from 'react';
import { ToneColor } from '../theme/designTokens';

interface BadgeProps {
  children: React.ReactNode;
  tone?: ToneColor;
  icon?: React.ReactNode;
  animated?: boolean;
  className?: string;
}

/**
 * Reusable Badge component for status indicators, labels, and tags
 * Replaces hardcoded badge markup with consistent styling
 */
export const Badge: React.FC<BadgeProps> = ({
  children,
  tone = 'default',
  icon,
  animated = false,
  className = '',
}) => {
  const baseClasses = `inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase`;

  const toneClasses: Record<ToneColor, string> = {
    default: 'bg-tone-default-bg border-tone-default-border text-tone-default-text',
    ok: 'bg-tone-ok-bg border-tone-ok-border text-tone-ok-text',
    warn: 'bg-tone-warn-bg border-tone-warn-border text-tone-warn-text',
    error: 'bg-tone-error-bg border-tone-error-border text-tone-error-text',
  };

  return (
    <div className={`${baseClasses} ${toneClasses[tone]} ${className}`}>
      {icon && <span className={animated ? 'animate-pulse' : ''}>{icon}</span>}
      {children}
    </div>
  );
};

export default Badge;
