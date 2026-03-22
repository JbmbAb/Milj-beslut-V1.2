import React from 'react';
import type { SearchStatusResponse } from '../../types';

interface IndexStatusPanelProps {
  searchStatus: SearchStatusResponse | null;
}

const IndexStatusPanel: React.FC<IndexStatusPanelProps> = ({ searchStatus }) => {
  if (!searchStatus || !searchStatus.summary) return null;

  const { summary } = searchStatus;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Globalt Index-status</p>
      <div className="mt-6 flex flex-wrap gap-8">
        <div className="flex flex-col">
          <span className="text-3xl font-black text-slate-900">{summary.documentsTotal.toLocaleString('sv-SE')}</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Totalt dokument</span>
        </div>
        <div className="flex flex-col">
          <span className="text-3xl font-black text-teal-600">{summary.embeddedChunks.toLocaleString('sv-SE')}</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-teal-500">Vektoriserade Chunks</span>
        </div>
        <div className="flex flex-col">
          <span className="text-3xl font-black text-indigo-600">{summary.chunkEmbeddingCoveragePct}%</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Täckningsgrad</span>
        </div>
        <div className="flex flex-col">
          <span className="text-3xl font-black text-amber-600">{summary.jobsPending + summary.jobsRunning}</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">Aktiva kö-jobb</span>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-[10px] font-black uppercase text-slate-500">Dokumentkvalitet</p>
          <div className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between">
              <span>Text extraction</span>
              <span className="font-bold text-slate-700">{summary.textExtractedDocuments}</span>
            </div>
            <div className="flex justify-between">
              <span>Metadata only</span>
              <span className="font-bold text-slate-400">{summary.metadataOnlyDocuments}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-[10px] font-black uppercase text-slate-500">Felhantering</p>
          <div className="mt-2 space-y-1 text-xs text-red-600">
            <div className="flex justify-between">
              <span>Misslyckade dok</span>
              <span className="font-bold">{summary.failedDocuments}</span>
            </div>
            <div className="flex justify-between">
              <span>Misslyckade jobb</span>
              <span className="font-bold">{summary.jobsFailed}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default IndexStatusPanel;
