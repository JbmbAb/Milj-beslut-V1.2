import React from 'react';
import { designTokens, ToneColor } from '../theme/designTokens';

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
    default: 'bg-slate-500/10 border border-slate-500/20 text-slate-400',
    ok: 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400',
    warn: 'bg-amber-500/10 border border-amber-500/20 text-amber-400',
    error: 'bg-red-500/10 border border-red-500/20 text-red-400',
  };

  return (
    <div className={`${baseClasses} ${toneClasses[tone]} ${className}`}>
      {icon && <span className={animated ? 'animate-pulse' : ''}>{icon}</span>}
      {children}
    </div>
  );
};

export default Badge;
