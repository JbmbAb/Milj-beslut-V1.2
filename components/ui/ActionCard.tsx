import React from 'react';
import { ToneColor } from '../theme/designTokens';

interface ActionCardProps {
  title: string;
  description: string;
  tone?: ToneColor;
  actionLabel: string;
  onAction: () => void;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Reusable action card component for call-to-action items
 * Extracted from Guide.tsx ActionItem with enhanced flexibility
 */
export const ActionCard: React.FC<ActionCardProps> = ({
  title,
  description,
  tone = 'default',
  actionLabel,
  onAction,
  icon,
  className = '',
}) => {
  const toneClasses: Record<ToneColor, string> = {
    default: 'border-slate-200 bg-white',
    ok: 'border-emerald-200 bg-emerald-50',
    warn: 'border-amber-200 bg-amber-50',
    error: 'border-red-200 bg-red-50',
  };

  const buttonToneClasses: Record<ToneColor, string> = {
    default: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    ok: 'border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
    warn: 'border-amber-300 bg-amber-100 text-amber-700 hover:bg-amber-200',
    error: 'border-red-300 bg-red-100 text-red-700 hover:bg-red-200',
  };

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClasses[tone]} ${className}`}>
      <div className="flex items-start gap-3">
        {icon && <span className="mt-1 text-lg">{icon}</span>}
        <div className="flex-1">
          <p className="text-sm font-black text-slate-900">{title}</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-700">{description}</p>
          <button
            type="button"
            onClick={onAction}
            className={`mt-4 rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${buttonToneClasses[tone]}`}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActionCard;
