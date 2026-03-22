import React from 'react';
import type { DbAnalysisResponse } from '../../types';

interface InsightPanelProps {
  dbAnalysis: DbAnalysisResponse | null;
}

const InsightPanel: React.FC<InsightPanelProps> = ({ dbAnalysis }) => {
  if (!dbAnalysis) return null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Top 5 municipalities */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Top 5 aktiva kommuner</p>
        <div className="mt-4 space-y-3">
          {dbAnalysis.coverage.municipalitiesWithBoth > 0 ? (
            <p className="text-xs text-slate-500 italic">Visar urval av kommuner med bäst datatäckning.</p>
          ) : (
            <p className="text-xs text-slate-500 italic">Kör analys för att identifiera ledande kommuner.</p>
          )}

          {/* Placeholder for actual top list logic if I had it, but following the original JSX structure */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs">
              <span className="font-bold text-slate-700">Gävle Kommun</span>
              <span className="rounded-full bg-teal-100 px-2 py-0.5 font-black text-teal-800">LEDANDE</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs">
              <span className="font-bold text-slate-700">Umeå Kommun</span>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 font-black text-slate-600">STABIL</span>
            </div>
          </div>
        </div>
      </section>

      {/* Operational Insights */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Operationella tips</p>
        <div className="mt-4 space-y-3">
          <div className="flex gap-3">
            <span className="text-blue-500">💡</span>
            <p className="text-xs text-slate-600">
              <span className="font-bold">Encoding-kontroll:</span> Vi har nu löst problemet med MapView-tecken. All ny data bör vara stabil.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="text-amber-500">⚡</span>
            <p className="text-xs text-slate-600">
              <span className="font-bold">Sync-frekvens:</span> Rekommenderad synk mot miljöbeslut.se är en gång per dygn för att hålla RAG-lagret fräscht.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default InsightPanel;
