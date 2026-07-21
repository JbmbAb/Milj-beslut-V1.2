import React from 'react';
import type { SearchStatusResponse, SearchFilters, SearchMode } from '../../types';

export const SearchInfo: React.FC<{ status: SearchStatusResponse | null }> = ({ status }) => {
  if (!status) return null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Dokumentstatus</p>
        <div className="space-y-1.5">
          {status.documents.map((d) => (
            <div key={d.status} className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-600">{d.status}</span>
              <span className="font-black text-slate-900">{d.count}</span>
            </div>
          ))}
          {status.summary && (
            <div className="mt-2 border-t border-slate-200 pt-2 text-[10px] text-slate-400 space-y-0.5">
              <p>Totalt: {status.summary.documentsTotal}</p>
              <p>
                Embedded: {status.summary.embeddedDocuments} ({status.summary.chunkEmbeddingCoveragePct}%)
              </p>
              <p>
                Chunks: {status.summary.totalChunks} (E: {status.summary.embeddedChunks})
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Jobb / Köstatus</p>
        <div className="space-y-1.5">
          {status.jobs.length === 0 ? (
            <p className="text-[10px] text-slate-400 italic">Inga aktiva eller senaste jobb.</p>
          ) : (
            status.jobs.map((j) => (
              <div key={j.status} className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-600">{j.status}</span>
                <span
                  className={`font-black ${j.status === 'done' ? 'text-emerald-600' : j.status === 'failed' ? 'text-red-500' : 'text-amber-600'}`}
                >
                  {j.count}
                </span>
              </div>
            ))
          )}
          {status.summary && (
            <div className="mt-2 border-t border-slate-200 pt-2 text-[10px] text-slate-400 space-y-0.5">
              <p>Pending: {status.summary.jobsPending}</p>
              <p>Running: {status.summary.jobsRunning}</p>
              <p>Failed: {status.summary.jobsFailed}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface SearchAndSyncPanelProps {
  query: string;
  setQuery: (v: string) => void;
  searchMode: SearchMode;
  setSearchMode: (v: SearchMode) => void;
  topK: number;
  setTopK: (v: number) => void;
  strictEvidence: boolean;
  setStrictEvidence: (v: boolean) => void;
  filters: SearchFilters;
  setFilters: (f: (prev: SearchFilters) => SearchFilters) => void;
  projectId: string;
  busy: string;
  token: string;
  runSearch: () => void;
  syncRegistry: () => void;
  syncStatus: string;
  searchStatus: SearchStatusResponse | null;
}

const SearchAndSyncPanel: React.FC<SearchAndSyncPanelProps> = ({
  query,
  setQuery,
  searchMode,
  setSearchMode,
  topK,
  setTopK,
  strictEvidence,
  setStrictEvidence,
  filters,
  setFilters,
  projectId,
  busy,
  token,
  runSearch,
  syncRegistry,
  syncStatus,
  searchStatus,
}) => {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">
              AI Sök & Webbindexering
            </p>
            <h3 className="text-lg font-black text-slate-900">Hybrid sökning i dokument & krav</h3>
            <p className="mt-1 text-xs text-slate-500">
              Kör semantisk (AI) eller lexikal sökning i databasen. Kan köras mot specifikt projekt eller
              globalt för admin.
            </p>
          </div>
          <button
            data-testid="admin-sync-button"
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
            disabled={Boolean(busy) || syncStatus === 'RUNNING' || !token}
            onClick={syncRegistry}
          >
            {syncStatus === 'RUNNING' ? 'Synkar...' : 'Synka från Miljobeslut.se'}
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <input
            data-testid="admin-search-input"
            className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-5 py-4 text-sm font-medium placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none transition-all"
            placeholder="Vad letar du efter? (t.ex. 'Bullerskydd vid nyanlagning' eller 'Högsta tillåtna ljudnivå')"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && runSearch()}
          />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <select
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"
              value={searchMode}
              onChange={(e) => setSearchMode(e.target.value as SearchMode)}
            >
              <option value="semantic">Semantisk (AI)</option>
              <option value="lexical">Lexikal (Sökord)</option>
              <option value="hybrid">Hybrid (Båda)</option>
            </select>

            <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <span className="text-[10px] font-black uppercase text-slate-400">Top-K:</span>
              <input
                type="number"
                className="w-10 text-xs font-bold text-slate-700 focus:outline-none"
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={strictEvidence}
                onChange={(e) => setStrictEvidence(e.target.checked)}
              />
              <span className="text-[10px] font-black uppercase text-slate-500">Strict Evidence</span>
            </label>

            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs placeholder:text-slate-400"
              placeholder="Kommun-filter"
              value={filters.municipality || ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, municipality: e.target.value || undefined }))}
            />

            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs placeholder:text-slate-400"
              placeholder="Avfallskod-filter"
              value={filters.wasteType || ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, wasteType: e.target.value || undefined }))}
            />

            <button
              data-testid="admin-run-search-button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-200 hover:scale-[1.02] active:scale-100 transition-all disabled:opacity-60"
              disabled={Boolean(busy) || !token}
              onClick={runSearch}
            >
              {busy === 'search' ? 'Söker...' : 'Kör sökning'}
            </button>
          </div>
        </div>

        <SearchInfo status={searchStatus} />

        {!projectId && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <span className="font-black">ADMIN-LÄGE:</span> Sökning körs mot hela miljöbeslut-databasen
            (globalt).
          </div>
        )}
      </div>
    </section>
  );
};

export default SearchAndSyncPanel;
