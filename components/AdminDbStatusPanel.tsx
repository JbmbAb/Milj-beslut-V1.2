/**
 * AdminDbStatusPanel.tsx
 *
 * Dedikerad databas-statuspanel i admin-konsolen.
 *
 * Visar automatiskt (utan klick) när panelen mountas:
 *   - Databaskoppling: OK / EJ KONFIGURERAD
 *   - Antal dokument (DocumentRecord)
 *   - Antal kravrader (RequirementRecord)
 *   - Antal kommuner med data
 *   - Datakvalitetsgränser (thresholds)
 *   - Per-kommunuppdelning
 */

import React, { useEffect, useRef, useState } from 'react';
import type { DbStatsResponse } from '../types';

const TOKEN_KEY = 'miljobeslut_admin_bearer';

const AdminDbStatusPanel: React.FC = () => {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) || '' : '';

  const [stats, setStats] = useState<DbStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const hasFetched = useRef(false);

  const secureReq = async <T,>(
    path: string,
    method: 'GET',
  ): Promise<T> => {
    if (!token) throw new Error('Ingen admin-token – logga in i Admin sökcenter först');
    const response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const json = await response.json();
    if (!response.ok || !json?.ok) throw new Error(json?.error || `HTTP ${response.status}`);
    return json as T;
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await secureReq<{ ok: true; stats: DbStatsResponse }>(
        '/api/admin/db-stats',
        'GET',
      );
      setStats(data.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte hämta DB-statistik');
    } finally {
      setLoading(false);
    }
  };

  // Auto-load once on mount
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasToken = Boolean(token);

  return (
    <div className="space-y-6 p-6">
      {/* ── Header ── */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">
          Admin · Databasstatus
        </p>
        <h2 className="mt-1 text-2xl font-black text-slate-900">Databas&shy;status</h2>
        <p className="mt-1 text-sm text-slate-500">
          Antal dokument, kravrader och kommuner i PostgreSQL-databasen.
        </p>
      </div>

      {/* ── Connection badge ── */}
      <div className="flex items-center gap-3">
        {!hasToken ? (
          <span
            data-testid="db-status-badge-no-token"
            className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-1.5 text-xs font-bold text-amber-800"
          >
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            EJ INLOGGAD – logga in i Admin sökcenter
          </span>
        ) : loading ? (
          <span
            data-testid="db-status-badge-loading"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-4 py-1.5 text-xs font-bold text-slate-600"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
            Ansluter…
          </span>
        ) : error && !stats ? (
          <span
            data-testid="db-status-badge-error"
            className="inline-flex items-center gap-2 rounded-full border border-red-300 bg-red-50 px-4 py-1.5 text-xs font-bold text-red-800"
          >
            <span className="h-2 w-2 rounded-full bg-red-500" />
            ANSLUTNINGSFEL
          </span>
        ) : stats ? (
          <span
            data-testid="db-status-badge-ok"
            className="inline-flex items-center gap-2 rounded-full border border-green-300 bg-green-50 px-4 py-1.5 text-xs font-bold text-green-800"
          >
            <span className="h-2 w-2 rounded-full bg-green-500" />
            ANSLUTEN
          </span>
        ) : null}

        <button
          data-testid="db-status-refresh-button"
          className="rounded-xl bg-teal-600 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          disabled={loading || !hasToken}
          onClick={() => void load()}
        >
          {loading ? 'Hämtar…' : 'Uppdatera'}
        </button>
      </div>

      {/* ── Error message ── */}
      {error && (
        <div
          data-testid="db-status-error"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {/* ── KPI cards ── */}
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {/* Documents */}
            <div
              data-testid="db-kpi-documents"
              className={`rounded-2xl border p-5 text-center ${
                stats.thresholds.documentsOk
                  ? 'border-teal-200 bg-teal-50'
                  : 'border-red-200 bg-red-50'
              }`}
            >
              <p
                className={`text-[11px] font-black uppercase tracking-widest ${
                  stats.thresholds.documentsOk ? 'text-teal-700' : 'text-red-700'
                }`}
              >
                Dokument {stats.thresholds.documentsOk ? '✓' : '✗'}
              </p>
              <p
                data-testid="db-kpi-documents-value"
                className={`mt-1 text-4xl font-black tabular-nums ${
                  stats.thresholds.documentsOk ? 'text-teal-900' : 'text-red-900'
                }`}
              >
                {stats.totals.documents.toLocaleString('sv-SE')}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                min {stats.thresholds.minDocuments.toLocaleString('sv-SE')}
              </p>
            </div>

            {/* Requirements (kravrader) */}
            <div
              data-testid="db-kpi-requirements"
              className={`rounded-2xl border p-5 text-center ${
                stats.thresholds.requirementsOk
                  ? 'border-indigo-200 bg-indigo-50'
                  : 'border-red-200 bg-red-50'
              }`}
            >
              <p
                className={`text-[11px] font-black uppercase tracking-widest ${
                  stats.thresholds.requirementsOk ? 'text-indigo-700' : 'text-red-700'
                }`}
              >
                Kravrader {stats.thresholds.requirementsOk ? '✓' : '✗'}
              </p>
              <p
                data-testid="db-kpi-requirements-value"
                className={`mt-1 text-4xl font-black tabular-nums ${
                  stats.thresholds.requirementsOk ? 'text-indigo-900' : 'text-red-900'
                }`}
              >
                {stats.totals.requirements.toLocaleString('sv-SE')}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                varav {stats.totals.requirementsFromCases.toLocaleString('sv-SE')} via ärenden·{' '}
                {stats.totals.requirementsExtracted.toLocaleString('sv-SE')} via e-post
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                min {stats.thresholds.minRequirements.toLocaleString('sv-SE')}
              </p>
            </div>

            {/* Municipalities */}
            <div
              data-testid="db-kpi-municipalities"
              className={`rounded-2xl border p-5 text-center ${
                stats.thresholds.municipalitiesOk
                  ? 'border-violet-200 bg-violet-50'
                  : 'border-red-200 bg-red-50'
              }`}
            >
              <p
                className={`text-[11px] font-black uppercase tracking-widest ${
                  stats.thresholds.municipalitiesOk ? 'text-violet-700' : 'text-red-700'
                }`}
              >
                Kommuner {stats.thresholds.municipalitiesOk ? '✓' : '✗'}
              </p>
              <p
                data-testid="db-kpi-municipalities-value"
                className={`mt-1 text-4xl font-black tabular-nums ${
                  stats.thresholds.municipalitiesOk ? 'text-violet-900' : 'text-red-900'
                }`}
              >
                {stats.totals.municipalities.toLocaleString('sv-SE')}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                min {stats.thresholds.minMunicipalities.toLocaleString('sv-SE')}
              </p>
            </div>

            {/* Overall status */}
            <div
              data-testid="db-kpi-overall"
              className={`rounded-2xl border p-5 text-center ${
                stats.thresholds.allOk
                  ? 'border-green-200 bg-green-50'
                  : 'border-orange-200 bg-orange-50'
              }`}
            >
              <p
                className={`text-[11px] font-black uppercase tracking-widest ${
                  stats.thresholds.allOk ? 'text-green-700' : 'text-orange-700'
                }`}
              >
                Totalt
              </p>
              <p
                className={`mt-2 text-2xl font-black ${
                  stats.thresholds.allOk ? 'text-green-800' : 'text-orange-800'
                }`}
              >
                {stats.thresholds.allOk ? '✅ OK' : '⚠️ Lågt'}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                {stats.thresholds.allOk
                  ? 'Alla gränsvärden uppnådda'
                  : 'Minst ett gränsvärde ej uppnått'}
              </p>
            </div>
          </div>

          {/* ── Generated at ── */}
          <p className="text-xs text-slate-400">
            Genererad: {new Date(stats.generatedAt).toLocaleString('sv-SE')}
          </p>

          {/* ── Per-municipality table ── */}
          {stats.perMunicipality.length > 0 && (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-black text-slate-900">Per kommun</h3>
              <p className="mt-1 text-xs text-slate-500">
                Dokument och kravrader fördelat per kommun.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">
                      <th className="pb-2 pr-4">Kommun</th>
                      <th className="pb-2 pr-4 text-right">Dokument</th>
                      <th className="pb-2 text-right">Kravrader</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.perMunicipality.map((row) => (
                      <tr
                        key={row.municipality}
                        className="border-b border-slate-50 hover:bg-slate-50"
                      >
                        <td className="py-2 pr-4 font-medium text-slate-800">
                          {row.municipality}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-slate-700">
                          {row.documents.toLocaleString('sv-SE')}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-700">
                          {row.requirements.toLocaleString('sv-SE')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Placeholder when not yet loaded ── */}
      {!stats && !loading && !error && hasToken && (
        <p className="text-sm text-slate-500">Laddar statistik…</p>
      )}

      {/* ── Prisma schema reference ── */}
      <div className="rounded-2xl border border-slate-100 bg-slate-50 px-5 py-4 text-xs text-slate-500">
        <p className="font-bold text-slate-700">Databasschema (Prisma / PostgreSQL)</p>
        <p className="mt-1">28 modeller · 6 migrationer klara · Kräver DATABASE_URL i miljövariabler.</p>
        <p className="mt-1">
          Nyckelmodeller:{' '}
          <span className="font-mono">DocumentRecord</span> ·{' '}
          <span className="font-mono">RequirementRecord</span> ·{' '}
          <span className="font-mono">RequirementCase</span> ·{' '}
          <span className="font-mono">ExtractedRequirement</span>
        </p>
      </div>
    </div>
  );
};

export default AdminDbStatusPanel;
