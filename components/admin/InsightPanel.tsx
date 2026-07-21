import React from 'react';
import type { DbAnalysisResponse } from '../../types';

interface InsightPanelProps {
  dbAnalysis: DbAnalysisResponse | null;
}

const InsightPanel: React.FC<InsightPanelProps> = ({ dbAnalysis }) => {
  if (!dbAnalysis) return null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Kommuner med datatäckning */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">
          Kommuner med datatäckning
        </p>
        <div className="mt-4 space-y-3">
          {dbAnalysis.coverage.municipalitiesWithBoth > 0 ? (
            <>
              <p className="text-xs text-slate-500 italic">
                {dbAnalysis.coverage.municipalitiesWithBoth} kommuner har fullständig datatäckning (GIS +
                rapporterad verksamhet).
              </p>
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs">
                <span className="font-bold text-slate-700">Total coverage</span>
                <span className="rounded-full bg-teal-100 px-2 py-0.5 font-black text-teal-800">
                  {dbAnalysis.coverage.municipalitiesWithBoth} st
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500 italic">
              Ingen kommun har verifierad datatäckning än. Kör analys för att identifiera ledande kommuner.
            </p>
          )}
        </div>
      </section>

      {/* Operational Insights */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">
          Operationella tips
        </p>
        <div className="mt-4 space-y-3">
          <div className="flex gap-3">
            <span className="text-blue-500">💡</span>
            <p className="text-xs text-slate-600">
              <span className="font-bold">Encoding-kontroll:</span> Vi har nu löst problemet med
              MapView-tecken. All ny data bör vara stabil.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="text-amber-500">⚡</span>
            <p className="text-xs text-slate-600">
              <span className="font-bold">Sync-frekvens:</span> Rekommenderad synk mot Miljobeslut.se är en
              gång per dygn för att hålla RAG-lagret fräscht.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default InsightPanel;
