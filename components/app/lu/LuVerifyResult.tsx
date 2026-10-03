import React from 'react';
import type { LuVerifyTone, LuVerifyView } from './luVerifyPresentation';

/**
 * W-UI1 (A; owner decision 2026-10-02; U30R6 K10/K11): one verify answer as presentLuVerifyResult
 * classified it. Only a well-formed FULLY_BOUND_GREEN gets the positive colour and the "verifierad" head;
 * an older unbound form shows the owner's text in the warning colour; UNBOUND and anything not verified are
 * neutral (no claim either way); a DENY with deviations is red. Machine values only under "Teknisk
 * information" (collapsed).
 */
const TONE_STYLE: Readonly<Record<LuVerifyTone, { color: string; border: string }>> = {
  verified: { color: '#A5F3FC', border: 'transparent' },
  notice: { color: '#FDBA74', border: '#F97316' },
  denied: { color: '#F87171', border: 'transparent' },
  neutral: { color: '#CBD5E1', border: '#64748B' },
};

/** The test id per kind -- `lu-verify-result-pass` is ONLY the fully bound green result. */
const TEST_ID: Readonly<Record<LuVerifyView['kind'], string>> = {
  FULLY_BOUND_GREEN: 'lu-verify-result-pass',
  LEGACY_UNBOUND_NOTICE: 'lu-verify-result-legacy',
  DENY: 'lu-verify-result-mismatch',
  UNBOUND: 'lu-verify-result-unbound',
  NOT_VERIFIED: 'lu-verify-result-not-verified',
  OTHER_ASSESSMENT: 'lu-verify-result-other',
};

export const LuVerifyResultView: React.FC<{ result: LuVerifyView; shownId: string | null }> = ({ result, shownId }) => {
  const testId = TEST_ID[result.kind];
  const style = TONE_STYLE[result.tone];
  const headId = result.kind === 'DENY' ? 'lu-verify-result-mismatch-summary' : `${testId}-head`;
  const technicalId = result.kind === 'DENY' ? 'lu-verify-result-mismatch-technical' : 'lu-verify-result-technical';
  const bordered = style.border !== 'transparent';
  return (
    <div
      data-testid={testId}
      data-verify-presentation={result.kind}
      data-tone={result.tone}
      className={`text-sm space-y-1${bordered ? ' border p-3' : ''}`}
      style={{ color: style.color, ...(bordered ? { borderColor: style.border } : {}) }}
    >
      <p data-testid={headId} className="font-semibold">
        {result.headSv}
      </p>
      {result.lines.length > 0 ? (
        <ul data-testid="lu-verify-result-notices" className="space-y-0.5">
          {result.lines.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {result.scopeSv ? <p className="text-xs opacity-80">{result.scopeSv}</p> : null}
      <details data-testid={technicalId} className="text-xs opacity-80">
        <summary className="cursor-pointer">Teknisk information</summary>
        <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono break-all">
          {result.kind === 'OTHER_ASSESSMENT' ? (
            <>
              <dt className="opacity-60 font-sans">Visad bedömning</dt>
              <dd>{shownId ?? 'okänd'}</dd>
            </>
          ) : null}
          {result.technical.map((row, i) => (
            <React.Fragment key={`${i}-${row.label}`}>
              <dt className="opacity-60 font-sans">{row.label}</dt>
              <dd>{row.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </details>
    </div>
  );
};

export default LuVerifyResultView;
