import React, { useCallback, useEffect, useState } from 'react';
import type { FullStatusReport, IntegrationStatusEntry, AppFeature } from '../types';

const TOKEN_KEY = 'miljobeslut_admin_bearer';

function getToken(): string {
  return typeof window !== 'undefined' ? (localStorage.getItem(TOKEN_KEY) ?? '') : '';
}

async function secureGet<T>(path: string): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { headers });
  const json = (await res.json()) as { ok: boolean; report?: T; completion?: T; error?: string } & T;
  if (!res.ok || !(json as { ok?: boolean }).ok) {
    throw new Error((json as { error?: string }).error ?? 'HTTP ' + String(res.status));
  }
  return json as T;
}

type StatusBadgeProps = { status: string };
function StatusBadge({ status }: StatusBadgeProps) {
  const map: Record<string, string> = {
    CONFIGURED: 'bg-emerald-100 text-emerald-800',
    LIVE: 'bg-emerald-100 text-emerald-800',
    DONE: 'bg-emerald-100 text-emerald-800',
    PARTIAL: 'bg-amber-100 text-amber-800',
    NOT_CONFIGURED: 'bg-slate-100 text-slate-600',
    PENDING: 'bg-slate-100 text-slate-600',
    MOCK: 'bg-orange-100 text-orange-800',
    ERROR: 'bg-red-100 text-red-800',
    ok: 'bg-emerald-100 text-emerald-800',
    degraded: 'bg-amber-100 text-amber-800',
    error: 'bg-red-100 text-red-800',
  };
  const cls = map[status] ?? 'bg-slate-100 text-slate-600';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
            <i className={`fas ${icon} text-sm`} />
          </span>
          <span className="text-sm font-black text-slate-900 uppercase tracking-wide">{title}</span>
        </div>
        <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-slate-400 text-xs`} />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

function ProgressBar({ percent, color = 'bg-emerald-500' }: { percent: number; color?: string }) {
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-all`}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );
}

const IntegrationRow: React.FC<{ entry: IntegrationStatusEntry }> = ({ entry }) => {
  const isMock = entry.status === 'MOCK' || entry.status === 'NOT_CONFIGURED';
  return (
    <tr className={`border-b border-slate-100 last:border-0 ${isMock ? 'bg-orange-50/40' : ''}`}>
      <td className="py-2 pr-3 text-xs font-semibold text-slate-800 whitespace-nowrap">{entry.name}</td>
      <td className="py-2 pr-3">
        <StatusBadge status={entry.status} />
      </td>
      <td className="py-2 pr-3 text-[10px] text-slate-500 font-mono truncate max-w-[200px]">
        {entry.endpoint ?? '—'}
      </td>
      <td className="py-2 text-[10px] text-slate-600">{entry.note ?? '—'}</td>
    </tr>
  );
};

const FeatureRow: React.FC<{ feature: AppFeature }> = ({ feature }) => {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-1.5 pr-3 text-[11px] font-semibold text-slate-800">{feature.label}</td>
      <td className="py-1.5 pr-3">
        <StatusBadge status={feature.status} />
      </td>
      <td className="py-1.5 text-[10px] text-slate-500">{feature.note ?? ''}</td>
    </tr>
  );
};

export const SystemFunctionalAnalysis: React.FC = () => {
  const [report, setReport] = useState<FullStatusReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // PostGIS property/geo ping (UI is local-only; no live Lantmäteriet)
  const [postgisTestLoading, setPostgisTestLoading] = useState(false);
  const [postgisTestResult, setPostgisTestResult] = useState<{
    ok: boolean;
    version?: string;
    sridCount?: number;
    gistIndexCount?: number;
    lastSpatialMigration?: string | null;
    error?: string | null;
  } | null>(null);
  const [postgisTestError, setPostgisTestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await secureGet<{ ok: boolean; report: FullStatusReport }>('/api/admin/full-status');
      setReport((json as { ok: boolean; report: FullStatusReport }).report);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta systemanalys');
    } finally {
      setLoading(false);
    }
  }, []);

  const runPostgisPing = useCallback(async () => {
    setPostgisTestLoading(true);
    setPostgisTestError(null);
    setPostgisTestResult(null);
    try {
      const res = await fetch('/api/system/postgis');
      const json = (await res.json()) as {
        ok: boolean;
        postgis?: { version?: string; sridCount?: number; gistIndexCount?: number };
        lastSpatialMigration?: string | null;
        message?: string;
      };
      if (!json.ok) {
        throw new Error(json.message ?? 'PostGIS-ping misslyckades');
      }
      setPostgisTestResult({
        ok: true,
        version: json.postgis?.version,
        sridCount: json.postgis?.sridCount,
        gistIndexCount: json.postgis?.gistIndexCount,
        lastSpatialMigration: json.lastSpatialMigration ?? null,
        error: null,
      });
    } catch (err) {
      setPostgisTestError(err instanceof Error ? err.message : 'Okänt fel');
      setPostgisTestResult({ ok: false, error: err instanceof Error ? err.message : 'Okänt fel' });
    } finally {
      setPostgisTestLoading(false);
    }
  }, []);

  useEffect(() => {
     
    void load();
  }, [load]);

  if (loading && !report) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <i className="fas fa-spinner fa-spin text-2xl mr-3" />
        <span className="text-sm font-bold">Analyserar system…</span>
      </div>
    );
  }

  const inactiveIntegrations =
    report?.integrations.filter((i) => i.status === 'MOCK' || i.status === 'NOT_CONFIGURED') ?? [];
  const liveIntegrations =
    report?.integrations.filter((i) => i.status === 'CONFIGURED' || i.status === 'LIVE') ?? [];
  const allCategories = report?.completion.categories ?? [];
  const filteredCategories = selectedCategory
    ? allCategories.filter((c) => c.name === selectedCategory)
    : allCategories;

  const environmentVarsByCategory = report
    ? report.environment.vars.reduce<Record<string, FullStatusReport['environment']['vars']>>(
        (acc, variable) => {
          (acc[variable.category] = acc[variable.category] ?? []).push(variable);
          return acc;
        },
        {},
      )
    : {};
  const environmentVarEntries = Object.entries(environmentVarsByCategory) as Array<
    [string, FullStatusReport['environment']['vars']]
  >;

  return (
    <div className="p-5 max-w-6xl mx-auto space-y-1">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-wide">Total Funktionsanalys</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {lastRefresh ? `Senast uppdaterad: ${lastRefresh.toLocaleString('sv-SE')}` : 'Laddar systemdata…'}
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-wide hover:bg-slate-700 transition disabled:opacity-50"
        >
          <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`} />
          Uppdatera
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700 font-medium mb-4">
          <i className="fas fa-triangle-exclamation mr-2" />
          {error}
        </div>
      )}

      {report && (
        <>
          {/* Overall banner */}
          <div
            className={`rounded-xl p-4 border flex items-center gap-4 mb-4 ${report.overall === 'ok' ? 'bg-emerald-50 border-emerald-200' : report.overall === 'degraded' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}
          >
            <i
              className={`fas text-2xl ${report.overall === 'ok' ? 'fa-circle-check text-emerald-600' : report.overall === 'degraded' ? 'fa-triangle-exclamation text-amber-600' : 'fa-circle-xmark text-red-600'}`}
            />
            <div className="flex-1">
              <p className="text-sm font-black text-slate-900">
                Systemstatus: <StatusBadge status={report.overall} /> · DB-latens:{' '}
                {report.db.latencyMs != null ? `${report.db.latencyMs} ms` : '—'} · Uptime:{' '}
                {Math.floor(report.app.uptimeSeconds / 60)} min
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                v{report.app.version} · {report.app.environment} · Node {report.app.nodeVersion} · Analys:{' '}
                {new Date(report.generatedAt).toLocaleString('sv-SE')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black text-slate-900">{report.completion.donePercent}%</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">
                Produktionsklart (DONE)
              </p>
              <p className="text-lg font-black text-slate-600 mt-1">
                {report.completion.implementationPercent}%
              </p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">
                Kod/implementering
              </p>
              {report.completion.operationalCoverage && (
                <>
                  <p className="text-lg font-black text-indigo-600 mt-1">
                    {report.completion.operationalCoverage.percent}%
                  </p>
                  <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-wide">
                    Operativ täckning
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Feature Completion Overview */}
          <Section title="Feature Completion" icon="fa-gauge-high">
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Klara', value: report.completion.counts.done, color: 'text-emerald-700' },
                { label: 'Delvis', value: report.completion.counts.partial, color: 'text-amber-700' },
                { label: 'Ej startade', value: report.completion.counts.pending, color: 'text-slate-500' },
                { label: 'Totalt', value: report.completion.counts.total, color: 'text-slate-900' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100"
                >
                  <p className={`text-2xl font-black ${stat.color}`}>{stat.value}</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide mt-0.5">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>

            {/* Category filter */}
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border transition ${!selectedCategory ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
              >
                Alla
              </button>
              {allCategories.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => setSelectedCategory(cat.name === selectedCategory ? null : cat.name)}
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border transition ${cat.name === selectedCategory ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
                >
                  {cat.name} ({cat.done}/{cat.total})
                </button>
              ))}
            </div>

            {filteredCategories.map((cat) => (
              <div key={cat.name} className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-black text-slate-700 uppercase tracking-wide">
                    {cat.name}
                  </span>
                  <span className="text-xs font-bold text-slate-500">
                    {cat.percent}% ({cat.done}/{cat.total})
                  </span>
                </div>
                <ProgressBar
                  percent={cat.percent}
                  color={
                    cat.percent === 100
                      ? 'bg-emerald-500'
                      : cat.percent >= 80
                        ? 'bg-amber-400'
                        : 'bg-slate-400'
                  }
                />
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left">
                    <tbody>
                      {cat.features.map((f) => (
                        <FeatureRow key={f.id} feature={f} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </Section>

          {/* Integrations */}
          <Section title="Integrationer" icon="fa-plug">
            {inactiveIntegrations.length > 0 && (
              <div className="mb-4 p-3 rounded-xl bg-orange-50 border border-orange-200">
                <p className="text-xs font-black text-orange-800 uppercase tracking-wide mb-2">
                  <i className="fas fa-triangle-exclamation mr-1" />
                  {inactiveIntegrations.length} integrationer är ej konfigurerade eller blockerade
                </p>
                <ul className="text-xs text-orange-700 space-y-1">
                  {inactiveIntegrations.map((i) => (
                    <li key={i.name}>
                      <span className="font-bold">{i.name}</span>
                      {i.note ? ` — ${i.note}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-700">{liveIntegrations.length} aktiva</span>
              <span className="text-xs text-slate-400">/</span>
              <span className="text-xs font-bold text-orange-700">
                {inactiveIntegrations.length} ej konfigurerade
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-2 pr-3 text-[10px] font-black text-slate-500 uppercase tracking-wide">
                      Integration
                    </th>
                    <th className="pb-2 pr-3 text-[10px] font-black text-slate-500 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="pb-2 pr-3 text-[10px] font-black text-slate-500 uppercase tracking-wide">
                      Endpoint
                    </th>
                    <th className="pb-2 text-[10px] font-black text-slate-500 uppercase tracking-wide">
                      Notering
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.integrations.map((entry) => (
                    <IntegrationRow key={entry.name} entry={entry} />
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Environment Variables */}
          <Section title="Miljövariabler" icon="fa-key">
            <div className="mb-3 flex items-center gap-3">
              <span className="text-xs font-bold text-emerald-700">
                {report.environment.configured} konfigurerade
              </span>
              <span className="text-xs text-slate-400">/</span>
              <span className="text-xs text-slate-600">{report.environment.total} totalt</span>
              {report.environment.requiredMissing.length > 0 && (
                <span className="text-xs font-bold text-red-700">
                  <i className="fas fa-circle-exclamation mr-1" />
                  {report.environment.requiredMissing.length} obligatoriska saknas:{' '}
                  {report.environment.requiredMissing.join(', ')}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              {environmentVarEntries.map(([category, vars]) => (
                <div key={category} className="mb-4">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wide mb-1">
                    {category}
                  </p>
                  <div className="space-y-0.5">
                    {vars.map((v) => (
                      <div
                        key={v.name}
                        className={`flex items-center justify-between rounded-lg px-2 py-1 ${v.configured ? 'bg-emerald-50' : v.required ? 'bg-red-50' : 'bg-slate-50'}`}
                      >
                        <span className="text-[10px] font-mono text-slate-700">{v.name}</span>
                        <span
                          className={`text-[10px] font-bold ${v.configured ? 'text-emerald-700' : v.required ? 'text-red-700' : 'text-slate-400'}`}
                        >
                          {v.configured ? (v.maskedValue ?? '✓') : v.required ? 'SAKNAS' : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Database */}
          <Section title="Databas" icon="fa-database">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center">
                <p className="text-2xl font-black text-slate-900">
                  {report.database.totalRows.toLocaleString('sv-SE')}
                </p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">Totalt rader</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center">
                <p className="text-2xl font-black text-slate-900">{report.database.tables.length}</p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">Tabeller</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center">
                <p className="text-2xl font-black text-slate-900">
                  {report.database.recentAuditEvents.length}
                </p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">
                  Senaste händelser
                </p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center">
                <p
                  className={`text-2xl font-black ${report.db.latencyMs != null && report.db.latencyMs < 50 ? 'text-emerald-700' : 'text-amber-700'}`}
                >
                  {report.db.latencyMs != null ? `${report.db.latencyMs}ms` : '—'}
                </p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">DB-latens</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-2 pr-4 text-[10px] font-black text-slate-500 uppercase tracking-wide">
                      Tabell
                    </th>
                    <th className="pb-2 pr-4 text-[10px] font-black text-slate-500 uppercase tracking-wide">
                      Rader
                    </th>
                    <th className="pb-2 text-[10px] font-black text-slate-500 uppercase tracking-wide">
                      Senaste post
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.database.tables.map((t) => (
                    <tr key={t.table} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 pr-4 text-xs font-mono text-slate-700">{t.table}</td>
                      <td className="py-1.5 pr-4 text-xs font-bold text-slate-900">
                        {t.rows.toLocaleString('sv-SE')}
                      </td>
                      <td className="py-1.5 text-[10px] text-slate-500">
                        {t.latestEntry ? new Date(t.latestEntry).toLocaleString('sv-SE') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Background Services */}
          <Section title="Bakgrundstjänster" icon="fa-gears">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-2 h-2 rounded-full ${report.backgroundServices.outlookScheduler.running ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  />
                  <span className="text-xs font-bold text-slate-800">Outlook-inläsare</span>
                </div>
                <div className="text-right">
                  <StatusBadge
                    status={report.backgroundServices.outlookScheduler.running ? 'LIVE' : 'NOT_CONFIGURED'}
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {report.backgroundServices.outlookScheduler.totalRuns} körningar
                    {report.backgroundServices.outlookScheduler.lastRunAt &&
                      ` · Senast: ${new Date(report.backgroundServices.outlookScheduler.lastRunAt).toLocaleString('sv-SE')}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-bold text-slate-800">Prometheus metrics</span>
                </div>
                <div className="text-right">
                  <StatusBadge status="LIVE" />
                  <p className="text-[10px] text-slate-500 mt-0.5">GET /metrics</p>
                </div>
              </div>

              {report.backup.totalBackups > 0 && (
                <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50">
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs font-bold text-slate-800">Databasbackup</span>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={report.backup.latestBackupStatus ?? 'ok'} />
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {report.backup.totalBackups} backup{report.backup.totalBackups !== 1 ? 's' : ''}
                      {report.backup.latestBackupAt &&
                        ` · Senast: ${new Date(report.backup.latestBackupAt).toLocaleString('sv-SE')}`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* PostGIS property ping — UI is local-only */}
          <Section title="PostGIS — Fastighetsdata (lokal)" icon="fa-database">
            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                Hubbens karta och fastighetssök använder enbart lokal PostGIS (
                <code className="font-mono">core.property_unit</code>). Live-anrop till Lantmäteriet är
                avstängda i UI.
              </p>

              <button
                onClick={() => void runPostgisPing()}
                disabled={postgisTestLoading}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-wide hover:bg-slate-700 transition disabled:opacity-50"
              >
                <i className={`fas ${postgisTestLoading ? 'fa-spinner fa-spin' : 'fa-plug'}`} />
                Testa PostGIS-anslutning
              </button>

              {postgisTestError && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  <i className="fas fa-triangle-exclamation mr-1" />
                  {postgisTestError}
                </div>
              )}

              {postgisTestResult && (
                <div
                  className={`rounded-xl border p-4 space-y-3 ${postgisTestResult.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-300'}`}
                >
                  <div className="flex items-center gap-2">
                    <i
                      className={`fas ${postgisTestResult.ok ? 'fa-circle-check text-emerald-600' : 'fa-triangle-exclamation text-amber-600'} text-lg`}
                    />
                    <span className="text-sm font-black text-slate-900">
                      {postgisTestResult.ok ? 'PostGIS svarar ✓' : 'PostGIS-ping misslyckades'}
                    </span>
                    <StatusBadge status={postgisTestResult.ok ? 'LIVE' : 'ERROR'} />
                  </div>

                  {postgisTestResult.ok && (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-white/70 rounded p-2">
                        <p className="text-slate-500 font-medium mb-0.5">Version</p>
                        <p className="font-semibold text-slate-800">{postgisTestResult.version ?? '—'}</p>
                      </div>
                      <div className="bg-white/70 rounded p-2">
                        <p className="text-slate-500 font-medium mb-0.5">SRID-stöd</p>
                        <p className="font-semibold text-slate-800">{postgisTestResult.sridCount ?? '—'}</p>
                      </div>
                      <div className="bg-white/70 rounded p-2">
                        <p className="text-slate-500 font-medium mb-0.5">GIST-index</p>
                        <p className="font-semibold text-slate-800">
                          {postgisTestResult.gistIndexCount ?? '—'}
                        </p>
                      </div>
                      <div className="bg-white/70 rounded p-2">
                        <p className="text-slate-500 font-medium mb-0.5">Senaste spatial-migration</p>
                        <p className="font-semibold text-slate-800">
                          {postgisTestResult.lastSpatialMigration ?? '—'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* Recent Errors */}
          {report.recentErrors.length > 0 && (
            <Section title={`Senaste fel (${report.recentErrors.length})`} icon="fa-bug">
              <div className="space-y-2">
                {report.recentErrors.slice(0, 10).map((err) => (
                  <div
                    key={err.id}
                    className={`p-3 rounded-xl border text-xs ${err.severity === 'ERROR' || err.severity === 'CRITICAL' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={err.severity} />
                      <span className="font-mono text-slate-500 text-[10px]">{err.type}</span>
                      <span className="ml-auto text-[10px] text-slate-400">
                        {new Date(err.capturedAt).toLocaleString('sv-SE')}
                      </span>
                    </div>
                    <p className="text-slate-700 font-medium">{err.message}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
};

export default SystemFunctionalAnalysis;
