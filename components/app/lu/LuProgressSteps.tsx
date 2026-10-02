import React from 'react';

/**
 * DEMO M2a item 7: a step list whose every state comes from real, polled server state (bootstrap
 * queue status, geometry provisioning status, the in-flight run request, the evidence fetch). It has
 * no timers and no percentage: a step is only "done" when the data says so.
 */
export type LuProgressStepState = 'pending' | 'active' | 'done' | 'failed';

export interface LuProgressStep {
  readonly key: string;
  readonly label: string;
  readonly state: LuProgressStepState;
  readonly detail?: string;
}

const MARK: Record<LuProgressStepState, string> = { pending: '○', active: '…', done: '✓', failed: '✕' };
const COLOR: Record<LuProgressStepState, string> = {
  pending: '#64748B',
  active: '#67E8F9',
  done: '#34D399',
  failed: '#F87171',
};
const STATE_TEXT: Record<LuProgressStepState, string> = {
  pending: 'väntar',
  active: 'pågår',
  done: 'klart',
  failed: 'misslyckades',
};

export const LuProgressSteps: React.FC<{ steps: readonly LuProgressStep[]; testId?: string }> = ({ steps, testId = 'lu-progress' }) => (
  <ol data-testid={testId} className="mb-8 space-y-1 border p-4 text-sm" style={{ borderColor: '#334155' }} aria-live="polite">
    {steps.map((step) => (
      <li key={step.key} data-testid={`${testId}-${step.key}`} data-state={step.state} className="flex items-start gap-2">
        <span aria-hidden="true" className={step.state === 'active' ? 'animate-pulse' : undefined} style={{ color: COLOR[step.state], width: '1rem' }}>
          {MARK[step.state]}
        </span>
        <span style={{ opacity: step.state === 'pending' ? 0.6 : 1 }}>
          {step.label}
          <span className="sr-only"> ({STATE_TEXT[step.state]})</span>
          {step.detail ? <span className="opacity-70"> – {step.detail}</span> : null}
        </span>
      </li>
    ))}
  </ol>
);

export default LuProgressSteps;
