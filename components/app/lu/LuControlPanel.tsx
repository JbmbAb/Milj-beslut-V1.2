import React from 'react';
import type { LuCheckKey, LuCheckView, LuFindingLike, LuKnowledgeState } from './luControlChecks';
import { presentLuFinding, presentLuFindingSummary } from './luFindingPresentation';

/**
 * DEMO M2a items 3 + 5: the six LU v1 checks with a visible knowledge state, and an evidence panel
 * for the selected check. Pure presentation of `deriveLuControlChecks` output -- it fetches nothing.
 */

const STATE_STYLE: Readonly<Record<LuKnowledgeState, { color: string; border: string; background: string }>> = {
  HIT: { color: '#FCD34D', border: '#F59E0B', background: 'rgba(245,158,11,0.12)' },
  NO_HIT: { color: '#6EE7B7', border: '#10B981', background: 'rgba(16,185,129,0.10)' },
  NOT_CHECKED: { color: '#CBD5E1', border: '#64748B', background: 'transparent' },
  UNCERTAIN: { color: '#FDBA74', border: '#F97316', background: 'rgba(249,115,22,0.10)' },
  SOURCE_UNAVAILABLE: { color: '#FCA5A5', border: '#EF4444', background: 'rgba(239,68,68,0.10)' },
  LOADING: { color: '#94A3B8', border: '#475569', background: 'transparent' },
};

/** The property "Träff" means "found", not a risk signal, so it gets a neutral tone. */
const PROPERTY_FOUND_STYLE = { color: '#A5F3FC', border: '#22D3EE', background: 'rgba(34,211,238,0.08)' };

export const LuStateChip: React.FC<{ check: Pick<LuCheckView, 'key' | 'state' | 'stateLabel'> }> = ({ check }) => {
  const style = check.key === 'property' && check.state === 'HIT' ? PROPERTY_FOUND_STYLE : STATE_STYLE[check.state];
  return (
    <span
      data-testid={`lu-check-state-${check.key}`}
      data-state={check.state}
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
  ruleId: string | null;
  onClose: () => void;
}> = ({ check, findings, ruleId, onClose }) => {
  const related = ruleId ? findings.filter((f) => f.rule_id === ruleId) : [];
  return (
    <div data-testid="lu-check-details" className="border p-4 space-y-3" style={{ borderColor: '#334155' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest opacity-60">Underlag för kontrollen</p>
          <h3 className="text-lg font-bold">{check.label}</h3>
        </div>
        <button type="button" data-testid="lu-check-details-close" onClick={onClose} className="text-xs underline opacity-80">
          Stäng
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <LuStateChip check={check} />
        <span className="text-sm">{check.summary}</span>
      </div>
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
  selectedKey: LuCheckKey | null;
  onSelect: (key: LuCheckKey | null) => void;
  ruleIdFor: (key: LuCheckKey) => string | null;
}> = ({ checks, findings, selectedKey, onSelect, ruleIdFor }) => {
  const selected = checks.find((c) => c.key === selectedKey) ?? null;
  return (
    <section data-testid="lu-control-panel" className="space-y-3 mb-10">
      <h2 className="text-xs uppercase tracking-widest opacity-70">Kontroller</h2>
      <p className="text-xs opacity-60">
        ”Inte kontrollerat” betyder att det saknas ett kontrollresultat – inte att det saknas objekt.
      </p>
      <ul className="divide-y border" style={{ borderColor: '#334155' }}>
        {checks.map((check) => (
          <li key={check.key} data-testid={`lu-check-${check.key}`} data-state={check.state}>
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
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <LuCheckDetails check={selected} findings={findings} ruleId={ruleIdFor(selected.key)} onClose={() => onSelect(null)} />
      ) : null}
    </section>
  );
};

export default LuControlPanel;
