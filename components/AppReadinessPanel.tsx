import React, { useEffect, useState } from 'react';

interface ReadinessCheck {
  name: string;
  ok: boolean;
  note: string;
}

interface ReadinessTier {
  tier: 1 | 2 | 3;
  label: string;
  description: string;
  ready: boolean;
  checks: ReadinessCheck[];
}

interface HealthReport {
  ok: boolean;
  appVersion: string;
  checkedAt: string;
  overallReady: boolean;
  readyTiers: number;
  totalTiers: number;
  summary: string;
  tiers: ReadinessTier[];
  error?: string;
}

const TIER_ICONS: Record<number, string> = {
  1: 'fa-code',
  2: 'fa-database',
  3: 'fa-plug',
};

const TIER_COLORS: Record<string, string> = {
  ready: 'border-emerald-200 bg-emerald-50',
  notReady: 'border-amber-200 bg-amber-50',
};

function TierBadge({ ready }: { ready: boolean }) {
  return ready ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide bg-emerald-100 text-emerald-800">
      <i className="fas fa-check-circle" /> Klar
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide bg-amber-100 text-amber-800">
      <i className="fas fa-exclamation-triangle" /> Ej klar
    </span>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <i
        className={`fas ${check.ok ? 'fa-circle-check text-emerald-500' : 'fa-circle-xmark text-amber-500'} text-sm mt-0.5 flex-shrink-0`}
      />
      <div className="min-w-0">
        <span className="text-xs font-semibold text-slate-800">{check.name}</span>
        <p className="text-[11px] text-slate-500 leading-snug">{check.note}</p>
      </div>
    </div>
  );
}

function TierCard({ tier }: { tier: ReadinessTier }) {
  const [open, setOpen] = useState(true);
  const colorClass = tier.ready ? TIER_COLORS.ready : TIER_COLORS.notReady;
  return (
    <div className={`border rounded-xl overflow-hidden ${colorClass} mb-3`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-white/60 flex items-center justify-center">
            <i className={`fas ${TIER_ICONS[tier.tier] ?? 'fa-circle'} text-slate-600 text-sm`} />
          </span>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wide text-slate-900">
                Nivå {tier.tier} – {tier.label}
              </span>
              <TierBadge ready={tier.ready} />
            </div>
            <p className="text-[11px] text-slate-600">{tier.description}</p>
          </div>
        </div>
        <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-slate-400 text-xs`} />
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-black/5">
          {tier.checks.map((c) => (
            <CheckRow key={c.name} check={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AppReadinessPanel() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch('/api/health')
      .then((r) => r.json() as Promise<HealthReport>)
      .then((data) => {
        setReport(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Kunde inte hämta hälsostatus');
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="h-full overflow-y-auto p-6 bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-black uppercase tracking-widest text-slate-900">
            <i className="fas fa-shield-check mr-2 text-emerald-600" />
            App-garanti
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            3-nivå garanti-matris – visar när hela appen är funktionell
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-[11px] font-black uppercase tracking-wide bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          <i className={`fas fa-arrows-rotate text-slate-600 ${loading ? 'animate-spin' : ''}`} />
          Uppdatera
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <i className="fas fa-spinner fa-spin text-slate-400 text-2xl" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <p className="text-xs font-bold text-red-800">
            <i className="fas fa-triangle-exclamation mr-2" />
            Kunde inte hämta hälsostatus
          </p>
          <p className="text-[11px] text-red-600 mt-1">{error}</p>
        </div>
      )}

      {/* Report */}
      {!loading && report && report.ok && (
        <>
          {/* Summary Banner */}
          <div
            className={`rounded-xl p-4 mb-5 border ${report.overallReady ? 'bg-emerald-50 border-emerald-200' : report.readyTiers >= 2 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-slate-900">{report.summary}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Kontrollerades {new Date(report.checkedAt).toLocaleTimeString('sv-SE')} · Version {report.appVersion}
                </p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black text-slate-900">
                  {report.readyTiers}/{report.totalTiers}
                </span>
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">nivåer klara</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3 h-2 bg-white/60 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${report.overallReady ? 'bg-emerald-500' : report.readyTiers >= 2 ? 'bg-amber-500' : 'bg-red-400'}`}
                style={{ width: `${(report.readyTiers / report.totalTiers) * 100}%` }}
              />
            </div>
          </div>

          {/* Guarantee Matrix legend */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 mb-3">
              Garanti-matris – vad garanteras per nivå
            </p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-emerald-50 rounded-lg p-3">
                <i className="fas fa-code text-emerald-600 text-lg mb-1" />
                <p className="text-[10px] font-black text-slate-900">Nivå 1</p>
                <p className="text-[10px] text-slate-600">Alltid garanterad via CI-pipeline</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <i className="fas fa-database text-blue-600 text-lg mb-1" />
                <p className="text-[10px] font-black text-slate-900">Nivå 2</p>
                <p className="text-[10px] text-slate-600">Garanterad med DATABASE_URL + JWT</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <i className="fas fa-plug text-purple-600 text-lg mb-1" />
                <p className="text-[10px] font-black text-slate-900">Nivå 3</p>
                <p className="text-[10px] text-slate-600">Garanterad med alla env-variabler</p>
              </div>
            </div>
          </div>

          {/* Tier Cards */}
          {report.tiers.map((tier) => (
            <TierCard key={tier.tier} tier={tier} />
          ))}

          {/* Footer note */}
          <div className="mt-4 p-3 bg-slate-100 rounded-xl">
            <p className="text-[10px] text-slate-500 leading-relaxed">
              <i className="fas fa-info-circle mr-1" />
              <strong>Notera:</strong> Nivå 1 (kodkvalitet) verifieras alltid av CI-pipelinen (GitHub Actions).
              Nivå 2–3 kräver konfigurerade miljövariabler och verifieras här i realtid.
              Integrationstester mot live DB och E2E-tester kräver en körande lokal miljö.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
