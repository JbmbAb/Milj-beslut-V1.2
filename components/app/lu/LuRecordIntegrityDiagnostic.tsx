import React from 'react';
import type { LuRecordIntegrityView } from './luRecordIntegrity';

/**
 * W-UI1 (B; U20CDF4 beslut 1): the stored findings of a record whose integrity cannot be attested -- collapsed,
 * marked "overifierad diagnostik (auktoritativ: nej)", in a neutral tone: never a state chip, a risk colour or
 * an overall level, never the form of a valid assessment.
 */
export const LuRecordIntegrityDiagnostic: React.FC<{ view: LuRecordIntegrityView; testId: string }> = ({ view, testId }) => (
  <details data-testid={testId} data-authoritative="false" data-verified="false" className="text-xs" style={{ color: '#CBD5E1' }}>
    <summary className="cursor-pointer">{view.headSv}</summary>
    <div className="mt-1 space-y-1">
      <p>{view.noteSv}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
        {view.rows.map((row) => (
          <React.Fragment key={row.label}>
            <dt className="opacity-70">{row.label}</dt>
            <dd>{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {view.entries.length > 0 ? (
        <ul className="list-disc pl-5">
          {view.entries.map((entry, i) => (
            <li key={`${i}-${entry}`}>{entry}</li>
          ))}
        </ul>
      ) : null}
      {view.truncatedSv ? <p>{view.truncatedSv}</p> : null}
      {view.technical.length > 0 ? (
        <p className="font-mono break-all opacity-70">{view.technical.map((row) => `${row.label}: ${row.value}`).join(' · ')}</p>
      ) : null}
    </div>
  </details>
);

export default LuRecordIntegrityDiagnostic;
