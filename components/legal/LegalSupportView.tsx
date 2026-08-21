/**
 * LEGAL-ANSWER-PRODUCT-WIRING-01.
 *
 * The real "Juridiskt Stöd" view -- the minimal usable UI over the canonical governed
 * legal-answer chain. Talks ONLY to queryLegalAnswer() (POST /api/legal/answer). Never calls
 * /api/legal/search or /api/gemini, and never reconstructs or "improves" a citation -- every
 * field shown here is passed straight through from the server response.
 */
import React, { useState } from 'react';
import { Search, Loader2, AlertTriangle, BookOpen, ShieldAlert, HelpCircle } from 'lucide-react';
import {
  queryLegalAnswer,
  type LegalAnswerResponse,
} from '../../src/ui/api-client/legalAnswer.client';

type RequestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; response: LegalAnswerResponse };

function ModeBanner({ response }: { response: LegalAnswerResponse }) {
  switch (response.mode) {
    case 'ANSWERED':
      return null;
    case 'INSUFFICIENT_EVIDENCE':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-950/30 p-3 text-sm text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Underlaget räcker inte för ett tillförlitligt svar på den här frågan. Inget svar har genererats.</span>
        </div>
      );
    case 'QUERY_UNDERSPECIFIED':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
          <HelpCircle size={16} className="mt-0.5 shrink-0" />
          <span>Frågan är för allmänt formulerad för att kunna besvaras. Försök precisera vad du undrar över.</span>
        </div>
      );
    case 'NAMED_SOURCE_NOT_AVAILABLE':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-rose-800/40 bg-rose-950/30 p-3 text-sm text-rose-300">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            Frågan nämner en rättskälla som inte finns i det underlag som faktiskt hämtades in.
            {response.named_source_consistency?.reason ? ` (${response.named_source_consistency.reason})` : ''}
          </span>
        </div>
      );
    default:
      return null;
  }
}

export const LegalSupportView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<RequestState>({ status: 'idle' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || state.status === 'loading') return;
    setState({ status: 'loading' });
    try {
      const response = await queryLegalAnswer(query.trim(), { family: undefined });
      setState({ status: 'done', response });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Okänt fel' });
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-6" data-testid="legal-support-view">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen size={20} className="text-cyan-400" />
        <h1 className="text-lg font-bold text-slate-100">Juridiskt Stöd</h1>
      </div>
      <p className="text-sm text-slate-400 mb-4">
        Ställ en fråga om lagstiftning, praxis eller föreskrifter. Svaret bygger enbart på styrkt underlag
        med källhänvisningar -- inget svar lämnas utan att det kan spåras till en verklig källa.
      </p>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="T.ex. Vad säger miljöbalken om avfallshantering?"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-600 focus:outline-none"
          data-testid="legal-support-query-input"
        />
        <button
          type="submit"
          disabled={state.status === 'loading' || !query.trim()}
          className="flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="legal-support-submit"
        >
          {state.status === 'loading' ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Fråga
        </button>
      </form>

      {state.status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-slate-400" data-testid="legal-support-loading">
          <Loader2 size={16} className="animate-spin" />
          Hämtar och granskar underlag...
        </div>
      )}

      {state.status === 'error' && (
        <div
          className="flex items-start gap-2 rounded-lg border border-rose-800/40 bg-rose-950/30 p-3 text-sm text-rose-300"
          data-testid="legal-support-error"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      {state.status === 'done' && (
        <div className="space-y-4" data-testid="legal-support-result">
          <ModeBanner response={state.response} />

          {state.response.claims.length > 0 && (
            <div className="space-y-3">
              {state.response.claims.map((claim, i) => (
                <div key={i} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3" data-testid="legal-support-claim">
                  <p className="text-sm text-slate-200 mb-2">{claim.text}</p>
                  <div className="space-y-1">
                    {claim.citations.map((citation) => (
                      <div
                        key={citation.citation_id}
                        className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-xs text-slate-400"
                        data-testid="legal-support-citation"
                      >
                        <div>
                          <span className="text-slate-500">fragment:</span> {citation.fragment_id}
                        </div>
                        <div>
                          <span className="text-slate-500">materialisering:</span> {citation.materialization_id}
                        </div>
                        <div>
                          <span className="text-slate-500">källa:</span> {citation.source_provenance_refs.join(', ')}
                        </div>
                        <div>
                          <span className="text-slate-500">rank:</span> {citation.rank}
                          {' · '}
                          <span className="text-slate-500">score:</span> {citation.score.toFixed(4)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="text-[11px] text-slate-600" data-testid="legal-support-trace">
            query_run_identity: {state.response.query_run_identity}
          </div>
        </div>
      )}
    </div>
  );
};

export default LegalSupportView;
