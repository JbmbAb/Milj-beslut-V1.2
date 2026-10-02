import React from 'react';
import type { LuErrorPresentation } from './luErrorPresentation';

/**
 * DEMO M2b item 3: one way to show a failure -- a plain-Swedish line, an optional "Försök igen",
 * and the server's own text/codes only inside a collapsed "Teknisk information".
 */
export const LuErrorNotice: React.FC<{
  error: LuErrorPresentation;
  testId: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}> = ({ error, testId, onRetry, retrying = false, className = 'mb-4' }) => (
  <div data-testid={testId} data-error-kind={error.kind} className={`text-sm space-y-1 ${className}`}>
    <p data-testid={`${testId}-message`} style={{ color: '#F87171' }}>
      {error.messageSv}
    </p>
    {onRetry && error.retryable ? (
      <button
        type="button"
        data-testid={`${testId}-retry`}
        disabled={retrying}
        onClick={onRetry}
        className="px-3 py-1 text-xs font-semibold border disabled:opacity-40"
        style={{ borderColor: '#475569' }}
      >
        {retrying ? 'Försöker igen…' : 'Försök igen'}
      </button>
    ) : null}
    {error.technical.length > 0 ? (
      <details data-testid={`${testId}-technical`} className="text-xs opacity-70">
        <summary className="cursor-pointer">Teknisk information</summary>
        <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono break-all">
          {error.technical.map((row) => (
            <React.Fragment key={row.label}>
              <dt className="opacity-60 font-sans">{row.label}</dt>
              <dd>{row.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </details>
    ) : null}
  </div>
);

export default LuErrorNotice;
