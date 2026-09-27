/**
 * DEMO-01 view: ärende → förslag → radvis godkännande → två PDF-förslag. Demo branch only.
 *
 * Shows only what the server returns; nothing is suggested client-side. Every row shows its
 * source line. There is no submit: Mimer does not file anything (K-26 §6).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { callApi, getActiveProjectId } from '../../../services/coreApiClient';
import { formatSource } from '../../../server/modules/c-anmalan-demo/formatSource';
import type {
  DemoCase,
  DemoCaseInput,
  ProposalRow,
  ProposalSectionId,
  RequirementsSourceStatus,
} from '../../../server/modules/c-anmalan-demo/types';

const CODES = ['90.30', '90.40', '90.131'];

const SECTION_TITLES: Record<ProposalSectionId, string> = {
  verksamhetsutovare: '1. Verksamhetsutövare och fastighet',
  verksamhet: '2. Verksamhet och verksamhetskod',
  lokalisering: '3. Lokalisering',
  teknisk_beskrivning: '4. Teknisk beskrivning av lagringsytan',
  forsiktighetsmatt: '5. Försiktighetsmått',
  egenkontroll: 'Egenkontrollprogram: kontrollpunkter',
};

const TEXT_FIELDS: Array<[keyof DemoCaseInput, string]> = [
  ['verksamhetsutovare', 'Verksamhetsutövare'],
  ['avfallstyper', 'Avfallstyper (EWC)'],
  ['mangdPerArTon', 'Mängd per år (ton)'],
  ['maxSamtidigtLagradTon', 'Största mängd lagrad vid något tillfälle (ton)'],
  ['ytansKonstruktion', 'Lagringsytans konstruktion (tätskikt, bärlager)'],
  ['jordart', 'Jordart under ytan'],
  ['lutningAvrinning', 'Lutning och avrinning'],
  ['dagvatten', 'Dagvattenhantering'],
];

const emptyInput = (): DemoCaseInput => ({
  propertyDesignation: '',
  verksamhetskoder: [],
  avfallstyper: '',
  mangdPerArTon: '',
  maxSamtidigtLagradTon: '',
  verksamhetsutovare: '',
  ytansKonstruktion: '',
  jordart: '',
  lutningAvrinning: '',
  dagvatten: '',
  placeholder: true,
});

type Decision = { action: 'accept' } | { action: 'strike' } | { action: 'edit'; text: string };

interface StatusResponse {
  ok: boolean;
  releaseSha: string;
  requirements: RequirementsSourceStatus;
}

const API = '/api/demo/c-anmalan';

// src/index.css has an unlayered `button` reset (no border, no padding) that outranks Tailwind's
// layered utilities, so button box styles are set inline here instead of touching global CSS.
const primaryBtn = (background: string): React.CSSProperties => ({ padding: '6px 12px', borderRadius: 4, background, color: '#fff' });
const choiceBtn = (active: boolean, color: string): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 4,
  border: `1px solid ${active ? color : '#cbd5e1'}`,
  background: active ? color : 'transparent',
  color: active ? '#fff' : 'inherit',
});

export const CAnmalanDemoView: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [input, setInput] = useState<DemoCaseInput>(emptyInput);
  const [otherCode, setOtherCode] = useState('');
  const [record, setRecord] = useState<DemoCase | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<Array<{ id: string; timestamp: string; action: string; description: string }>>([]);

  useEffect(() => {
    callApi<StatusResponse>(`${API}/status`, { method: 'GET' })
      .then(setStatus)
      .catch((e) => setStatusError(e instanceof Error ? e.message : String(e)));
  }, []);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const codes = useMemo(
    () => [...input.verksamhetskoder, ...otherCode.split(/[,\s]+/).map((c) => c.trim()).filter(Boolean)],
    [input.verksamhetskoder, otherCode],
  );

  const saveInput = () =>
    run('Sparar ärendet', async () => {
      const body = { ...input, verksamhetskoder: codes };
      const res = record
        ? await callApi<{ case: DemoCase }>(`${API}/cases/${record.id}/input`, { method: 'PUT', body: { input: body } })
        : await callApi<{ case: DemoCase }>(`${API}/cases`, { method: 'POST', body: { projectId: getActiveProjectId(), input: body } });
      setRecord(res.case);
      setDecisions({});
    });

  const propose = () =>
    run('Tar fram förslag ur lager, lagtext och kommunkorpus', async () => {
      const res = await callApi<{ case: DemoCase }>(`${API}/cases/${record!.id}/proposal`, { method: 'POST' });
      setRecord(res.case);
      setDecisions({});
    });

  const rows = record?.proposal?.rows ?? [];
  const undecided = rows.filter((r) => !decisions[r.id]).length;

  const approve = () =>
    run('Fryser godkänt förslag', async () => {
      const body = {
        decisions: rows.map((r) => ({ rowId: r.id, ...decisions[r.id] })),
      };
      const res = await callApi<{ case: DemoCase }>(`${API}/cases/${record!.id}/approve`, { method: 'POST', body });
      setRecord(res.case);
      const trail = await callApi<{ entries: typeof audit }>(`${API}/cases/${record!.id}/audit-trail`, { method: 'GET' });
      setAudit(trail.entries);
    });

  const download = (kind: 'anmalan' | 'egenkontroll') =>
    run('Hämtar PDF', async () => {
      const blob = await callApi<Blob>(`${API}/cases/${record!.id}/pdf/${kind}`, { method: 'GET' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `demo01-${kind}-forslag-${record!.approval!.frozenSha256.slice(0, 12)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      const trail = await callApi<{ entries: typeof audit }>(`${API}/cases/${record!.id}/audit-trail`, { method: 'GET' });
      setAudit(trail.entries);
    });

  const setAll = (action: 'accept') =>
    setDecisions((prev) => Object.fromEntries(rows.map((r) => [r.id, prev[r.id] ?? { action }])));

  if (statusError) {
    return (
      <Shell onExit={onExit}>
        <p className="text-sm text-rose-700" data-testid="demo-disabled">
          Demon är inte aktiverad på servern (DEMO_C_ANMALAN_ENABLED). {statusError}
        </p>
      </Shell>
    );
  }

  const approved = record?.status === 'APPROVED' && record.approval;

  return (
    <Shell onExit={onExit}>
      {status && (
        <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <div>Release: <code>{status.releaseSha}</code></div>
          <div>Kommunkorpus (D2): {status.requirements.message}</div>
        </div>
      )}
      {error && <div role="alert" className="mb-4 rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      {busy && <div className="mb-4 text-sm text-slate-500">{busy}…</div>}

      <section className="mb-6 rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-base font-semibold">Ärende (användarens uppgifter)</h2>
        <label className="mb-3 block text-sm">
          Fastighetsbeteckning
          <input
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
            value={input.propertyDesignation}
            disabled={Boolean(record)}
            onChange={(e) => setInput({ ...input, propertyDesignation: e.target.value.toUpperCase() })}
            placeholder="t.ex. ORSA STACKMORA 3:12"
          />
        </label>
        <fieldset className="mb-3 text-sm">
          <legend>Verksamhetskod(er) – väljs av användaren, Mimer klassar inte</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {CODES.map((c) => (
              <label key={c} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={input.verksamhetskoder.includes(c)}
                  onChange={(e) =>
                    setInput({
                      ...input,
                      verksamhetskoder: e.target.checked ? [...input.verksamhetskoder, c] : input.verksamhetskoder.filter((x) => x !== c),
                    })
                  }
                />
                {c}
              </label>
            ))}
            <label className="flex items-center gap-1">
              annan kod
              <input className="w-28 rounded border border-slate-300 px-1" value={otherCode} onChange={(e) => setOtherCode(e.target.value)} />
            </label>
          </div>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {TEXT_FIELDS.map(([field, label]) => (
            <label key={field} className="block text-sm">
              {label}
              <textarea
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
                rows={2}
                value={String(input[field] ?? '')}
                onChange={(e) => setInput({ ...input, [field]: e.target.value })}
                placeholder="användarens uppgift"
              />
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={input.placeholder} onChange={(e) => setInput({ ...input, placeholder: e.target.checked })} />
          Uppgifterna är platshållare (underlaget är inte ifyllt)
        </label>
        <div className="mt-3 flex gap-2">
          <button type="button" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50" style={primaryBtn('#1e293b')}
            disabled={Boolean(busy) || !input.propertyDesignation.trim() || codes.length === 0} onClick={saveInput}>
            {record ? 'Spara ändrade uppgifter' : 'Skapa ärende'}
          </button>
          <button type="button" className="rounded bg-indigo-700 px-3 py-1.5 text-sm text-white disabled:opacity-50" style={primaryBtn('#4338ca')}
            disabled={Boolean(busy) || !record} onClick={propose}>
            Ta fram förslag
          </button>
        </div>
      </section>

      {rows.length > 0 && !approved && (
        <section className="mb-6 rounded border border-slate-200 bg-white p-4" data-testid="proposal">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Förslag – granska rad för rad</h2>
            <button type="button" className="text-xs text-indigo-700 underline" onClick={() => setAll('accept')}>
              Godta alla ej beslutade rader
            </button>
          </div>
          <p className="mb-3 text-xs text-amber-700">{record?.proposal?.inputs.localizationLabel}</p>
          {(Object.keys(SECTION_TITLES) as ProposalSectionId[]).map((section) => {
            const sectionRows = rows.filter((r) => r.section === section);
            if (sectionRows.length === 0) return null;
            return (
              <div key={section} className="mb-4">
                <h3 className="mb-2 text-sm font-semibold">{SECTION_TITLES[section]}</h3>
                {sectionRows.map((r) => (
                  <RowCard key={`${record?.proposal?.generatedAt}-${r.id}`} row={r} decision={decisions[r.id]} onDecide={(d) => setDecisions((p) => ({ ...p, [r.id]: d }))} />
                ))}
              </div>
            );
          })}
          {record?.proposal?.inputs.requirements.state !== 'loaded' && (
            <p className="mb-3 text-xs text-amber-700">Inga förslag ur kommunkorpusen: {record?.proposal?.inputs.requirements.message}</p>
          )}
          <button type="button" className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50" style={primaryBtn('#047857')}
            disabled={Boolean(busy) || undecided > 0} onClick={approve} data-testid="approve">
            Godkänn förslag ({rows.length - undecided} av {rows.length} rader beslutade)
          </button>
        </section>
      )}

      {approved && record?.approval && (
        <section className="mb-6 rounded border border-emerald-300 bg-emerald-50 p-4" data-testid="approved">
          <h2 className="mb-2 text-base font-semibold">Godkänt och fryst</h2>
          <p className="break-all text-xs text-slate-700">Fryst JSON sha256: <code>{record.approval.frozenSha256}</code></p>
          <p className="mb-3 break-all text-xs text-slate-700">Release: <code>{record.approval.releaseSha}</code></p>
          <div className="flex gap-2">
            <button type="button" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white" style={primaryBtn('#1e293b')} onClick={() => download('anmalan')}>
              PDF: C-anmälan – förslag, ej inlämnad
            </button>
            <button type="button" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white" style={primaryBtn('#1e293b')} onClick={() => download('egenkontroll')}>
              PDF: Egenkontrollprogram – förslag
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-600">Mimer lämnar inte in. Inlämning görs av verksamhetsutövaren.</p>
          {audit.length > 0 && (
            <ul className="mt-3 break-all text-xs text-slate-600">
              {audit.map((a) => (
                <li key={a.id}>{a.timestamp.slice(0, 19).replace('T', ' ')} · {a.action} · {a.description}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Shell>
  );
};

const Shell: React.FC<{ onExit: () => void; children: React.ReactNode }> = ({ onExit, children }) => (
  <div className="min-h-screen bg-slate-100 text-slate-900">
    <header className="flex items-center justify-between border-b border-slate-300 bg-white px-6 py-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">Förslag – ej inlämnad · demo, ej governed</div>
        <h1 className="text-lg font-semibold">C-anmälan (DEMO-01)</h1>
      </div>
      <button type="button" className="text-sm text-slate-600 underline" onClick={onExit}>Till Mimer</button>
    </header>
    <main className="mx-auto max-w-5xl p-6">{children}</main>
  </div>
);

const RowCard: React.FC<{ row: ProposalRow; decision?: Decision; onDecide: (d: Decision) => void }> = ({ row, decision, onDecide }) => {
  const [draft, setDraft] = useState(row.text);
  const editing = decision?.action === 'edit';
  return (
    <div
      className={`mb-2 rounded border p-3 ${decision?.action === 'strike' ? 'border-slate-200 bg-slate-50 opacity-60' : decision ? 'border-emerald-300' : 'border-slate-300'}`}
      data-testid={`row-${row.id}`}
    >
      <div className="text-sm font-medium">{row.label}</div>
      {editing ? (
        <textarea className="mt-1 w-full rounded border border-slate-300 p-1 text-sm" rows={3} value={draft}
          onChange={(e) => { setDraft(e.target.value); onDecide({ action: 'edit', text: e.target.value }); }} />
      ) : (
        <div className={`mt-1 whitespace-pre-wrap text-sm ${decision?.action === 'strike' ? 'line-through' : ''}`}>{row.text}</div>
      )}
      {row.control && (
        <div className="mt-1 text-xs text-slate-700">
          Frekvens: {row.control.frekvens} · Metod: {row.control.metod} · Ansvarig: {row.control.ansvarig} · Dokumentation: {row.control.dokumentation} · Avvikelse: {row.control.avvikelse}
        </div>
      )}
      {row.note && <div className="mt-1 text-xs text-amber-700">{row.note}</div>}
      <div className="mt-1 text-xs text-slate-500">{formatSource(row.provenance)}</div>
      <div className="mt-2 flex gap-2 text-xs">
        <button type="button" style={choiceBtn(decision?.action === 'accept', '#059669')} onClick={() => onDecide({ action: 'accept' })}>Godta</button>
        <button type="button" style={choiceBtn(editing, '#4f46e5')} onClick={() => onDecide({ action: 'edit', text: draft })}>Ändra</button>
        <button type="button" style={choiceBtn(decision?.action === 'strike', '#475569')} onClick={() => onDecide({ action: 'strike' })}>Stryk</button>
      </div>
    </div>
  );
};

export default CAnmalanDemoView;
