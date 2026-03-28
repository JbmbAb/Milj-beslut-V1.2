import React from 'react';
import type { DbStatsResponse } from '../../types';

interface DatabaseStatsSectionProps {
  dbStats: DbStatsResponse | null;
  busy: boolean;
  token: string;
  onLoad: () => void;
}

const DatabaseStatsSection: React.FC<DatabaseStatsSectionProps> = ({ dbStats, busy, token, onLoad }) => {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Databasinnehåll</p>
          <h3 className="text-lg font-black text-slate-900">Kravrader · Kommuner · Dokument</h3>
          <p className="mt-1 text-xs text-slate-500">Antal kravrader, kommuner och dokument i databasen – totalt och per kommun.</p>
        </div>
        <button
          data-testid="admin-load-db-stats-button"
          className="rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          disabled={busy || !token}
          onClick={onLoad}
        >
          {busy ? 'Hämtar...' : 'Hämta statistik'}
        </button>
      </div>

      {!dbStats && (
        <p className="mt-4 text-sm text-slate-500">Klicka "Hämta statistik" för att se antal kravrader, kommuner och dokument.</p>
      )}

      {dbStats && (
        <>
          <p className="mt-3 text-xs text-slate-500">Genererad: {new Date(dbStats.generatedAt).toLocaleString('sv-SE')}</p>

          {/* ── Threshold warning banner ── */}
          {!dbStats.thresholds.allOk && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
              <span className="mt-0.5 text-lg leading-none">⚠️</span>
              <div>
                <p className="text-sm font-black text-red-800">Datakvalitetsgräns ej uppnådd</p>
                <ul className="mt-1 list-disc pl-4 text-xs text-red-700 space-y-0.5">
                  {!dbStats.thresholds.requirementsOk && (
                    <li>Kravrader: {dbStats.totals.requirements.toLocaleString('sv-SE')} av {dbStats.thresholds.minRequirements.toLocaleString('sv-SE')} krävda</li>
                  )}
                  {!dbStats.thresholds.municipalitiesOk && (
                    <li>Kommuner: {dbStats.totals.municipalities.toLocaleString('sv-SE')} av {dbStats.thresholds.minMunicipalities.toLocaleString('sv-SE')} krävda</li>
                  )}
                  {!dbStats.thresholds.documentsOk && (
                    <li>Dokument: {dbStats.totals.documents.toLocaleString('sv-SE')} av {dbStats.thresholds.minDocuments.toLocaleString('sv-SE')} krävda</li>
                  )}
                </ul>
              </div>
            </div>
          )}
          {dbStats.thresholds.allOk && (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
              <span className="text-base leading-none">✅</span>
              <p className="text-sm font-bold text-green-800">Alla datakvalitetsgränser uppnådda</p>
            </div>
          )}

          {/* ── Summary cards ── */}
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className={`rounded-2xl border p-4 text-center ${dbStats.thresholds.documentsOk ? 'border-teal-200 bg-teal-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-[11px] font-black uppercase tracking-widest ${dbStats.thresholds.documentsOk ? 'text-teal-700' : 'text-red-700'}`}>
                Dokument {dbStats.thresholds.documentsOk ? '✓' : '✗'}
              </p>
              <p className={`mt-1 text-3xl font-black ${dbStats.thresholds.documentsOk ? 'text-teal-900' : 'text-red-900'}`}>
                {dbStats.totals.documents.toLocaleString('sv-SE')}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">min {dbStats.thresholds.minDocuments.toLocaleString('sv-SE')}</p>
            </div>
            <div className={`rounded-2xl border p-4 text-center ${dbStats.thresholds.requirementsOk ? 'border-indigo-200 bg-indigo-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-[11px] font-black uppercase tracking-widest ${dbStats.thresholds.requirementsOk ? 'text-indigo-700' : 'text-red-700'}`}>
                Kravrader {dbStats.thresholds.requirementsOk ? '✓' : '✗'}
              </p>
              <p className={`mt-1 text-3xl font-black ${dbStats.thresholds.requirementsOk ? 'text-indigo-900' : 'text-red-900'}`}>
                {dbStats.totals.requirements.toLocaleString('sv-SE')}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">min {dbStats.thresholds.minRequirements.toLocaleString('sv-SE')}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                <span>{dbStats.totals.requirementsFromCases.toLocaleString('sv-SE')} ärenden</span>
                {' + '}
                <span>{dbStats.totals.requirementsExtracted.toLocaleString('sv-SE')} utdrag</span>
              </p>
            </div>
            <div className={`rounded-2xl border p-4 text-center ${dbStats.thresholds.municipalitiesOk ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
              <p className={`text-[11px] font-black uppercase tracking-widest ${dbStats.thresholds.municipalitiesOk ? 'text-amber-700' : 'text-red-700'}`}>
                Kommuner {dbStats.thresholds.municipalitiesOk ? '✓' : '✗'}
              </p>
              <p className={`mt-1 text-3xl font-black ${dbStats.thresholds.municipalitiesOk ? 'text-amber-900' : 'text-red-900'}`}>
                {dbStats.totals.municipalities.toLocaleString('sv-SE')}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">min {dbStats.thresholds.minMunicipalities.toLocaleString('sv-SE')}</p>
            </div>
          </div>

          {dbStats.perMunicipality.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 mb-2">Per kommun</p>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Kommun</th>
                      <th className="px-4 py-2 text-right">Dokument</th>
                      <th className="px-4 py-2 text-right">Kravrader</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dbStats.perMunicipality.map((row) => (
                      <tr key={row.municipality} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium text-slate-800">{row.municipality}</td>
                        <td className="px-4 py-2 text-right font-semibold text-teal-700">{row.documents.toLocaleString('sv-SE')}</td>
                        <td className="px-4 py-2 text-right font-semibold text-indigo-700">{row.requirements.toLocaleString('sv-SE')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default DatabaseStatsSection;
