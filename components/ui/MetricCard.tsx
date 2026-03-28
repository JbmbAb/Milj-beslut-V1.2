import React from 'react';
import { ToneColor, toneColors } from '../theme/designTokens';

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
    default: 'border-slate-200 bg-white text-slate-800',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-red-200 bg-red-50 text-red-800',
  };

  return (
    <div
      className={`rounded-xl border px-3 py-2 shadow-sm ${toneClasses[tone]} ${className}`}
    >
      <div className="flex items-center gap-2">
        {icon && <span className="text-[12px]">{icon}</span>}
        <p className="text-[10px] font-black uppercase tracking-[0.12em] opacity-70">
          {label}
        </p>
      </div>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
};

export default MetricCard;
