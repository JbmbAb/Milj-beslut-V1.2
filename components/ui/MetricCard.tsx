import React from 'react';
import { ToneColor } from '../theme/designTokens';

interface MetricCardProps {
  label: string;
  value: string | number;
  tone?: ToneColor;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Reusable metric/stat card component
 * Extracted from Guide.tsx MetricTile to be shareable across application
 */
export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  tone = 'default',
  icon,
  className = '',
}) => {
  const toneClasses: Record<ToneColor, string> = {
    default: 'border-tone-default-border bg-tone-default-bg text-tone-default-text',
    ok: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-text',
    warn: 'border-tone-warn-border bg-tone-warn-bg text-tone-warn-text',
    error: 'border-tone-error-border bg-tone-error-bg text-tone-error-text',
  };

  return (
    <div className={`rounded-xl border px-3 py-2 shadow-sm ${toneClasses[tone]} ${className}`}>
      <div className="flex items-center gap-2">
        {icon && <span className="text-[12px]">{icon}</span>}
        <p className="text-[10px] font-black uppercase tracking-[0.12em] opacity-70">{label}</p>
      </div>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
};

export default MetricCard;
