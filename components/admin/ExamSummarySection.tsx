import React from 'react';
import type { AdminExamSummary } from '../../types';
import { KpiCard } from './SharedAdminComponents';

interface ExamSummarySectionProps {
  examSummary: AdminExamSummary | null;
  busy: boolean;
  token: string;
  onLoad: () => void;
}

const ExamSummarySection: React.FC<ExamSummarySectionProps> = ({ examSummary, busy, token, onLoad }) => {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Systematisk Examensanalys</p>
          <h3 className="text-lg font-black text-slate-900">Analys av hela plattformen</h3>
          <p className="mt-1 text-xs text-slate-500">Aggregerad data över alla projekt, användare, dokument och sökningar.</p>
        </div>
        <button
          className="rounded-xl bg-violet-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          disabled={busy || !token}
          onClick={onLoad}
        >
          {busy ? 'Genererar...' : 'Hämta examensrapport'}
        </button>
      </div>

      {!examSummary && (
        <p className="mt-4 text-sm text-slate-500">Klicka "Hämta examensrapport" för att se helhetsstatistiken.</p>
      )}

      {examSummary && (
        <div className="mt-5 space-y-6">
          <p className="text-xs text-slate-500">Genererad: {new Date(examSummary.generatedAt).toLocaleString('sv-SE')}</p>

          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-500">Huvudsiffror</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-9">
              <KpiCard label="Org" value={String(examSummary.totals.organisations)} />
              <KpiCard label="Anv" value={String(examSummary.totals.users)} />
              <KpiCard label="Projekt" value={String(examSummary.totals.projects)} />
              <KpiCard label="Aktiva" value={String(examSummary.totals.activeProjects)} />
              <KpiCard label="Index" value={String(examSummary.totals.indexedProjects)} />
              <KpiCard label="Dok" value={String(examSummary.totals.documents)} />
              <KpiCard label="Sök" value={String(examSummary.totals.searches)} />
              <KpiCard label="Audit" value={String(examSummary.totals.auditRecords)} />
              <KpiCard label="Plan" value={String(examSummary.totals.planStates)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">Dokument per status</p>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-slate-100">
                    {examSummary.documentsByStatus.map((row) => (
                      <tr key={row.status} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 font-bold text-slate-700">{row.status}</td>
                        <td className="px-3 py-1.5 text-right font-black text-slate-900">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">Sökprestanda (snitt)</p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-600">Svarstid (ms)</span>
                  <span className="text-lg font-black text-slate-900">{Math.round(examSummary.searchPerformance.avgElapsedMs)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">Antal resultat</span>
                  <span className="text-lg font-black text-slate-900">{examSummary.searchPerformance.avgResults.toFixed(1)}</span>
                </div>
                <p className="mt-3 text-[10px] text-slate-400">Senaste sökning: {examSummary.searchPerformance.latestQueryAt ? new Date(examSummary.searchPerformance.latestQueryAt).toLocaleString('sv-SE') : 'Aldrig'}</p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">EU-Taxonomi Readiness</p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-600">Berättigade</span>
                  <span className="text-lg font-black text-slate-900">{examSummary.euTaxonomy.eligibleProjects}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">Inriktade</span>
                  <span className="text-lg font-black text-slate-900">{examSummary.euTaxonomy.alignedProjects}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600">Alignment (%)</span>
                  <span className="text-lg font-black text-teal-600">{examSummary.euTaxonomy.alignmentPct}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default ExamSummarySection;
