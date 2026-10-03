import React from 'react';
import type { LuCheckRowKey, LuCheckView, LuFindingLike, LuKnowledgeState } from './luControlChecks';
import { presentLuFinding, presentLuFindingSummary } from './luFindingPresentation';
import { luRetryButtonLabelSv } from './luErrorPresentation';

/**
 * DEMO M2a items 3 + 5, M2b item 1, W-M2d item 1: the LU v1 checks with a visible knowledge state,
 * and an evidence panel for the selected check. Pure presentation of `presentLuControlChecks` output
 * (the server's own checks) -- it fetches nothing; "Försök igen" only calls back to the workspace.
 */

const STATE_STYLE: Readonly<Record<LuKnowledgeState, { color: string; border: string; background: string }>> = {
  HIT: { color: '#FCD34D', border: '#F59E0B', background: 'rgba(245,158,11,0.12)' },
  NO_HIT: { color: '#6EE7B7', border: '#10B981', background: 'rgba(16,185,129,0.10)' },
  NOT_CHECKED: { color: '#CBD5E1', border: '#64748B', background: 'transparent' },
  SOURCE_UNAVAILABLE: { color: '#FCA5A5', border: '#EF4444', background: 'rgba(239,68,68,0.10)' },
  UNCERTAIN: { color: '#FDBA74', border: '#F97316', background: 'rgba(249,115,22,0.10)' },
  // Its own colour: a technical failure is neither a data gap (orange) nor an unavailable source (red).
  TECHNICAL_ERROR: { color: '#F0ABFC', border: '#C026D3', background: 'rgba(192,38,211,0.12)' },
  LOADING: { color: '#94A3B8', border: '#475569', background: 'transparent' },
};

/** The property "Hittad" means "found", not a risk signal, so it gets a neutral tone. */
const PROPERTY_FOUND_STYLE = { color: '#A5F3FC', border: '#22D3EE', background: 'rgba(34,211,238,0.08)' };

/**
 * DEMO M2c item 1, W-M2d items 3 + 9: a negative result from a register KNOWN to cover only part of the
 * check's name (e.g. Natura 2000 with SPA only), or on a dataset version outside the import contracts,
 * is never green -- text, border and background are the warning colour (M2c verification: green text
 * with an orange border still read as green).
 */
const LIMITED_NO_HIT_STYLE = { color: '#FDBA74', border: '#F97316', background: 'rgba(249,115,22,0.08)' };

export const LuStateChip: React.FC<{
  check: Pick<LuCheckView, 'key' | 'state' | 'stateLabel'> & { coverageLimited?: boolean; datasetVersionUnknown?: boolean; rootAssuranceQualified?: boolean };
}> = ({ check }) => {
  // W-M2d item 3: a checked result on a limited basis or an unknown dataset version is never plain green.
  // W-M2e item 3: a found property whose root the server states with lower assurance is qualified too.
  const qualified = check.rootAssuranceQualified
    ? 'root-assurance'
    : check.datasetVersionUnknown
      ? 'unknown-version'
      : check.coverageLimited
        ? 'limited'
        : undefined;
  const style =
    check.key === 'property' && check.state === 'HIT'
      ? check.rootAssuranceQualified
        ? LIMITED_NO_HIT_STYLE
        : PROPERTY_FOUND_STYLE
      : check.state === 'NO_HIT' && qualified
        ? LIMITED_NO_HIT_STYLE
        : STATE_STYLE[check.state];
  return (
    <span
      data-testid={`lu-check-state-${check.key}`}
      data-state={check.state}
      data-coverage={check.coverageLimited ? 'limited' : undefined}
      data-qualified={qualified}
      className="inline-block whitespace-nowrap px-2 py-0.5 text-[11px] font-bold"
      style={{
        color: style.color,
        border: `1px ${check.state === 'NOT_CHECKED' ? 'dashed' : 'solid'} ${style.border}`,
        background: style.background,
      }}
    >
      {check.stateLabel}
    </span>
  );
};

export const LuCheckDetails: React.FC<{
  check: LuCheckView;
  findings: readonly LuFindingLike[];
  onClose: () => void;
}> = ({ check, findings, onClose }) => {
  const related = check.ruleId ? findings.filter((f) => f.rule_id === check.ruleId) : [];
  return (
    <div data-testid="lu-check-details" className="border p-4 space-y-3" style={{ borderColor: '#334155' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest opacity-60">Underlag för kontrollen</p>
          <h3 className="text-lg font-bold" style={{ color: 'inherit' }}>{check.label}</h3>
        </div>
        <button type="button" data-testid="lu-check-details-close" onClick={onClose} className="text-xs underline opacity-80">
          Stäng
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <LuStateChip check={check} />
        <span className="text-sm">{check.summary}</span>
      </div>
      {check.coverageNote ? (
        <p
          data-testid="lu-check-details-coverage-note"
          className="text-xs"
          style={check.coverageLimited ? { color: '#FDBA74' } : { opacity: 0.8 }}
        >
          {check.coverageNote}
        </p>
      ) : null}
      {check.registerNote ? (
        <p data-testid="lu-check-details-register-note" className="text-xs opacity-80">
          {check.registerNote}
        </p>
      ) : null}
      {check.details.length > 0 ? (
        <dl data-testid="lu-check-details-rows" className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          {check.details.map((row) => (
            <React.Fragment key={row.label}>
              <dt className="opacity-60">{row.label}</dt>
              <dd data-testid={`lu-check-detail-${row.label}`}>{row.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
      {related.length > 0 ? (
        <div>
          <p className="text-xs uppercase tracking-widest opacity-60 mb-1">Fynd i bedömningen</p>
          <ul className="text-sm space-y-1">
            {related.map((f) => {
              const p = presentLuFinding(f);
              return (
                <li key={f.finding_id}>
                  {p.attentionLabel}: {presentLuFindingSummary(f)}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {check.technical.length > 0 ? (
        <details data-testid="lu-check-technical" className="text-xs opacity-80">
          <summary className="cursor-pointer">Teknisk information</summary>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono break-all">
            {check.technical.map((row) => (
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
};

export const LuControlPanel: React.FC<{
  checks: readonly LuCheckView[];
  findings: readonly LuFindingLike[];
  selectedKey: LuCheckRowKey | null;
  onSelect: (key: LuCheckRowKey | null) => void;
  /** Shown only when at least one check is a technical error that can be retried. */
  onRetry?: (() => void) | null;
  /**
   * W-UI1-R3 (owner decision 2026-10-03): 'reread' when the button only reads the assessment again (the property
   * root's read error, an incoherence) -- it says "Läs in på nytt"; 'retry' (default) when a server-retryable failure
   * is repeated -- "Försök igen".
   */
  retryKind?: 'retry' | 'reread';
  retrying?: boolean;
  /** A short honest note under the list (e.g. that the server's answer lacks the document check). */
  note?: string | null;
}> = ({ checks, findings, selectedKey, onSelect, onRetry = null, retryKind = 'retry', retrying = false, note = null }) => {
  const selected = checks.find((c) => c.key === selectedKey) ?? null;
  // W-UI1 (D): the property root's transient read error is re-read (W-UI1-R3: "Läs in på nytt").
  const hasTechnicalError = checks.some((c) => c.state === 'TECHNICAL_ERROR' || c.rootReadRetryable);
  return (
    <section data-testid="lu-control-panel" className="space-y-3 mb-10">
      <h2 className="text-xs uppercase tracking-widest opacity-70" style={{ color: 'inherit' }}>Kontroller</h2>
      <p className="text-xs opacity-60">
        ”Inte kontrollerat” betyder att det saknas ett kontrollresultat – inte att det saknas objekt. ”Tekniskt fel” betyder
        att resultatet inte kunde hämtas eller kontrolleras – inte att underlaget är bristfälligt. ”Begränsad täckning” betyder
        att registret bara innehåller en del av det som kontrollens namn omfattar.
      </p>
      <ul className="divide-y border" style={{ borderColor: '#334155' }}>
        {checks.map((check) => (
          <li
            key={check.key}
            data-testid={`lu-check-${check.key}`}
            data-state={check.state}
            data-coverage={check.coverageLimited ? 'limited' : undefined}
            data-known-gaps={check.knownGaps.length > 0 ? check.knownGaps.map((gap) => gap.id).join(' ') : undefined}
          >
            <button
              type="button"
              data-testid={`lu-check-select-${check.key}`}
              onClick={() => onSelect(selectedKey === check.key ? null : check.key)}
              aria-expanded={selectedKey === check.key}
              className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-white/5"
            >
              <span className="font-semibold min-w-[14rem]">{check.label}</span>
              <LuStateChip check={check} />
              <span className="text-sm opacity-80">{check.summary}</span>
              {check.knownGaps.length > 0 ? (
                // W-M2d item 3: the server's known gaps, each with its kind and date, next to the state.
                <span data-testid={`lu-check-gaps-${check.key}`} className="basis-full text-xs space-y-0.5" style={{ color: '#FDBA74' }}>
                  {check.knownGaps.map((gap) => (
                    <span
                      key={gap.id}
                      data-testid={`lu-check-gap-${check.key}-${gap.id}`}
                      data-gap-kind={gap.kind}
                      data-rechecked={gap.rechecked ? 'true' : 'false'}
                      className="block"
                    >
                      {gap.text}
                    </span>
                  ))}
                </span>
              ) : check.coverageNote ? (
                <span
                  data-testid={`lu-check-coverage-note-${check.key}`}
                  className="basis-full text-xs"
                  style={check.coverageLimited || check.datasetVersionUnknown ? { color: '#FDBA74' } : { opacity: 0.7 }}
                >
                  {check.coverageNote}
                </span>
              ) : null}
              {check.registerNote ? (
                <span data-testid={`lu-check-register-note-${check.key}`} className="basis-full text-xs opacity-60">
                  {check.registerNote}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {/* Static scope statement: LU v1 has no governed input for this, so nothing is claimed about it. */}
      <p data-testid="lu-control-out-of-scope" className="text-xs opacity-60">
        Inte bedömt: hydrologisk koppling (spridningsväg). Bedömningen innehåller inget underlag för det.
      </p>
      {hasTechnicalError && onRetry ? (
        <button
          type="button"
          data-testid="lu-control-retry"
          disabled={retrying}
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-semibold border disabled:opacity-40"
          style={{ borderColor: '#C026D3' }}
        >
          {luRetryButtonLabelSv(retryKind === 'reread', retrying)}
        </button>
      ) : null}
      {note ? (
        <p data-testid="lu-control-note" className="text-xs opacity-60">
          {note}
        </p>
      ) : null}
      {selected ? <LuCheckDetails check={selected} findings={findings} onClose={() => onSelect(null)} /> : null}
    </section>
  );
};

export default LuControlPanel;
