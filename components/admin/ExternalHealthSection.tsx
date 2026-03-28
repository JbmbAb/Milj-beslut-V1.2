import React from 'react';
import type { ExternalHealthReport } from '../../types';

const statusPillClass: Record<ExternalHealthReport['checks'][number]['status'], string> = {
  healthy: 'bg-emerald-100 text-emerald-800',
  degraded: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-800',
  not_configured: 'bg-slate-200 text-slate-700',
};

const modePillClass: Record<ExternalHealthReport['checks'][number]['mode'], string> = {
  live: 'bg-blue-50 text-blue-700 border border-blue-200',
  config: 'bg-slate-50 text-slate-600 border border-slate-200',
  derived: 'bg-violet-50 text-violet-700 border border-violet-200',
};

const KpiCard: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 text-base font-black text-white">{value}</p>
    </div>
  );
};

export const ExternalHealthPanel: React.FC<{ report: ExternalHealthReport | null }> = ({ report }) => {
  if (!report) {
    return <p className="mt-3 text-sm text-slate-500">Klicka "Extern API health" for att kontrollera integrationerna live.</p>;
  }

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Healthy" value={String(report.totals.healthy)} />
        <KpiCard label="Degraded" value={String(report.totals.degraded)} />
        <KpiCard label="Error" value={String(report.totals.error)} />
        <KpiCard label="Ej konfig" value={String(report.totals.notConfigured)} />
        <KpiCard label="Liveprobes" value={String(report.totals.liveChecked)} />
        <KpiCard label="Totalt" value={String(report.totals.total)} />
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Kontrollerad: {new Date(report.checkedAt).toLocaleString('sv-SE')} · Overgripande status:{' '}
        <span className={`font-black ${report.overall === 'ok' ? 'text-emerald-700' : report.overall === 'degraded' ? 'text-amber-700' : 'text-red-700'}`}>
          {report.overall}
        </span>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {report.categories.map((category) => (
          <span key={category.name} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold text-slate-600">
            {category.name}: {category.healthy}/{category.total} healthy
          </span>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 font-black">Integration</th>
              <th className="px-3 py-2 font-black">Status</th>
              <th className="px-3 py-2 font-black">Typ</th>
              <th className="px-3 py-2 font-black">Detalj</th>
              <th className="px-3 py-2 font-black">Endpoint</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.checks.map((check) => (
              <tr key={check.key} className="align-top hover:bg-slate-50">
                <td className="px-3 py-2">
                  <p className="font-bold text-slate-900">{check.label}</p>
                  <p className="text-[11px] text-slate-500">{check.category}</p>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${statusPillClass[check.status]}`}>
                      {check.status}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${modePillClass[check.mode]}`}>
                      {check.mode}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {check.activation || '-'}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {check.detail}
                  {typeof check.responseCode === 'number' && (
                    <span className="ml-1 text-slate-400">HTTP {check.responseCode}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {check.endpoint ? <span className="block max-w-[280px] truncate" title={check.endpoint}>{check.endpoint}</span> : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

interface ExternalHealthSectionProps {
  externalHealth: ExternalHealthReport | null;
  busy: boolean;
  token: string;
  onLoad: () => void;
}

const ExternalHealthSection: React.FC<ExternalHealthSectionProps> = ({ externalHealth, busy, token, onLoad }) => {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Extern health</p>
          <h3 className="text-lg font-black text-slate-900">Livebild av externa API:er och fallback-floden</h3>
          <p className="mt-1 text-xs text-slate-500">
            Healthy betyder verifierad liveprobe. Degraded betyder konfigurerad eller fallback, men inte fullt verifierad.
          </p>
        </div>
        <button
          className="rounded-xl bg-fuchsia-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          disabled={busy || !token}
          onClick={onLoad}
        >
          {busy ? 'Kontrollerar...' : 'Kör kontroll'}
        </button>
      </div>

      <ExternalHealthPanel report={externalHealth} />
    </section>
  );
};

export default ExternalHealthSection;
