import React from 'react';
import type { DbAnalysisResponse } from '../../types';

interface DatabaseAnalysisSectionProps {
  dbAnalysis: DbAnalysisResponse | null;
  busy: boolean;
  token: string;
  onLoad: () => void;
}

const DatabaseAnalysisSection: React.FC<DatabaseAnalysisSectionProps> = ({ dbAnalysis, busy, token, onLoad }) => {
  return (
    <section data-testid="db-analysis-section" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Databasanalys</p>
          <h3 className="text-lg font-black text-slate-900">Kategorier · Kvalitet · Täckning · Gap</h3>
          <p className="mt-1 text-xs text-slate-500">
            Djupanalys av kravkategorier, kodningskvalitet, dokumenttäckning och kommunala datalgap.
          </p>
        </div>
        <button
          data-testid="admin-load-db-analysis-button"
          className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          disabled={busy || !token}
          onClick={onLoad}
        >
          {busy ? 'Analyserar...' : 'Kör analys'}
        </button>
      </div>

      {!dbAnalysis && (
        <p className="mt-4 text-sm text-slate-500">
          Klicka "Kör analys" för att se en djupanalys av databasens innehåll.
        </p>
      )}

      {dbAnalysis && (
        <>
          <p className="mt-3 text-xs text-slate-500">Genererad: {new Date(dbAnalysis.generatedAt).toLocaleString('sv-SE')}</p>

          <div className="mt-5">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Dokumenttäckning</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Med krav</p>
                <p className="mt-1 text-2xl font-black text-indigo-900">{dbAnalysis.coverage.documentsWithRequirements.toLocaleString('sv-SE')}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Utan krav</p>
                <p className="mt-1 text-2xl font-black text-slate-700">{dbAnalysis.coverage.documentsWithoutRequirements.toLocaleString('sv-SE')}</p>
              </div>
              <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-teal-600">Täckningsgrad</p>
                <p className="mt-1 text-2xl font-black text-teal-900">{dbAnalysis.coverage.coverageRatioPct} %</p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Krav/dok (snitt)</p>
                <p className="mt-1 text-2xl font-black text-amber-900">{dbAnalysis.coverage.avgRequirementsPerCoveredDocument}</p>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-semibold text-slate-500 mb-2">Kommunnamnskvalitet (confidence-buckets)</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Hög ≥0.8', val: dbAnalysis.documents.municipalityConfidenceBuckets.high, color: 'bg-green-500' },
                  { label: 'Medel 0.5–0.8', val: dbAnalysis.documents.municipalityConfidenceBuckets.medium, color: 'bg-yellow-400' },
                  { label: 'Låg <0.5', val: dbAnalysis.documents.municipalityConfidenceBuckets.low, color: 'bg-red-400' },
                  { label: 'Saknas', val: dbAnalysis.documents.municipalityConfidenceBuckets.missing, color: 'bg-slate-300' },
                ].map((b) => (
                  <div key={b.label} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${b.color}`} />
                    <span className="font-medium text-slate-700">{b.label}</span>
                    <span className="font-black text-slate-900">{b.val.toLocaleString('sv-SE')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {(dbAnalysis.coverage.municipalitiesDocumentsOnly.length > 0 || dbAnalysis.coverage.municipalitiesRequirementsOnly.length > 0) && (
            <div className="mt-5">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Gap-analys: kommuner</p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Kommuner med båda ({dbAnalysis.coverage.municipalitiesWithBoth})
                  </p>
                  <p className="text-xs text-slate-500">Har både dokument och kravrader.</p>
                </div>
                {dbAnalysis.coverage.municipalitiesDocumentsOnly.length > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-1">
                      Dokument utan krav ({dbAnalysis.coverage.municipalitiesDocumentsOnly.length})
                    </p>
                    <ul className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                      {dbAnalysis.coverage.municipalitiesDocumentsOnly.map((m) => (
                        <li key={m} className="text-xs text-amber-800">{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {dbAnalysis.coverage.municipalitiesRequirementsOnly.length > 0 && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-1">
                      Krav utan dokument ({dbAnalysis.coverage.municipalitiesRequirementsOnly.length})
                    </p>
                    <ul className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                      {dbAnalysis.coverage.municipalitiesRequirementsOnly.map((m) => (
                        <li key={m} className="text-xs text-red-800">{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {dbAnalysis.requirements.byCategory.length > 0 && (
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Krav per kategori</p>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Kategori</th>
                        <th className="px-3 py-2 text-right">Antal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dbAnalysis.requirements.byCategory.map((r) => (
                        <tr key={r.category} className="hover:bg-slate-50">
                          <td className="px-3 py-1.5 font-medium text-slate-700">{r.category}</td>
                          <td className="px-3 py-1.5 text-right font-semibold text-indigo-700">{r.count.toLocaleString('sv-SE')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Kodningskvalitet (codingConfidence)</p>
                  <div className="flex flex-col gap-1.5">
                    {dbAnalysis.requirements.byCodingConfidence.map((r) => {
                      const total = dbAnalysis.requirements.byCodingConfidence.reduce((s, x) => s + x.count, 0);
                      const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
                      const barColor = r.confidence === 'HIGH' ? 'bg-green-500' : r.confidence === 'MEDIUM' ? 'bg-yellow-400' : 'bg-red-400';
                      return (
                        <div key={r.confidence}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-medium text-slate-600">{r.confidence}</span>
                            <span className="text-xs font-black text-slate-800">{r.count.toLocaleString('sv-SE')} ({pct}%)</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-slate-100">
                            <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Status i underrättelse</p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2 text-right">Antal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {dbAnalysis.requirements.byStatus.map((r) => (
                          <tr key={r.status} className="hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-medium text-slate-700">{r.status}</td>
                            <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{r.count.toLocaleString('sv-SE')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            {[
              { label: 'Krav med citeringar', val: dbAnalysis.requirements.withCitationsCount },
              { label: 'Totalt citeringar', val: dbAnalysis.requirements.citationsTotal },
              { label: 'Kommunspecifika krav', val: dbAnalysis.requirements.municipalitySpecificCount },
              { label: 'Minimikrav', val: dbAnalysis.requirements.minimumRequirementCount },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{item.label}</p>
                <p className="mt-0.5 text-lg font-black text-slate-900">{item.val.toLocaleString('sv-SE')}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
};

export default DatabaseAnalysisSection;
