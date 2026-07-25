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
    default: 'border-tone-default-border bg-tone-default-bg',
    ok: 'border-tone-ok-border bg-tone-ok-bg',
    warn: 'border-tone-warn-border bg-tone-warn-bg',
    error: 'border-tone-error-border bg-tone-error-bg',
  };

  const buttonToneClasses: Record<ToneColor, string> = {
    default: 'border-tone-default-border bg-tone-default-bg text-tone-default-text',
    ok: 'border-tone-ok-border bg-tone-ok-bg text-tone-ok-text',
    warn: 'border-tone-warn-border bg-tone-warn-bg text-tone-warn-text',
    error: 'border-tone-error-border bg-tone-error-bg text-tone-error-text',
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
