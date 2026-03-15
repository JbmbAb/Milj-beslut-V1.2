import React, { useEffect, useMemo, useState } from 'react';
import { useProjectStructure } from './ProjectStructureContext';
import { countReadyModules } from '../services/projectStructure';

interface ExecutiveSummaryProps {
  mode?: string;
}

const MAX_AUDIT_ROWS = 10;

const ExecutiveSummary: React.FC<ExecutiveSummaryProps> = ({ mode = 'summary' }) => {
  const { plan, gateStats, remoteSync } = useProjectStructure();

  const totalModules = plan.moduleIntegrations.length;
  const readyModules = useMemo(() => countReadyModules(plan), [plan]);
  const _blockedModules = useMemo(
    () => plan.moduleIntegrations.filter((item) => item.readiness === 'BLOCKED').length,
    [plan.moduleIntegrations]
  );

  const totalRequiredGates = useMemo(() => plan.stageGates.filter((gate) => gate.required).length, [plan.stageGates]);
  const passedRequiredGates = gateStats.passed;
  const blockedRequiredGates = gateStats.blocked;
  const gateCompletionPct = totalRequiredGates > 0 ? Math.round((passedRequiredGates / totalRequiredGates) * 100) : 0;

  const totalDocs = plan.documentArchive.length;
  const verifiedDocs = useMemo(() => plan.documentArchive.filter((doc) => doc.status === 'VERIFIED').length, [plan.documentArchive]);
  const draftDocs = useMemo(() => plan.documentArchive.filter((doc) => doc.status === 'DRAFT').length, [plan.documentArchive]);
  const archivedDocs = useMemo(() => plan.documentArchive.filter((doc) => doc.status === 'ARCHIVED').length, [plan.documentArchive]);

  const samplingDone = plan.samplingPreparation.checklist.filter((item) => item.done).length;
  const samplingTotal = plan.samplingPreparation.checklist.length;
  const _samplingPct = samplingTotal > 0 ? Math.round((samplingDone / samplingTotal) * 100) : 0;

  const carbonResult = plan.carbonSummary.lastResult;
  const carbonReady = Boolean(carbonResult);

  const [datasourceHealth, setDatasourceHealth] = useState<{
    connected: number;
    total: number;
    allOpenSourcesActive: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/datasources/health')
      .then((res) => {
        if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
        return res.json();
      })
      .then((data: { ok?: boolean; connected?: number; total?: number; allOpenSourcesActive?: boolean }) => {
        if (!cancelled && data.ok) {
          setDatasourceHealth({
            connected: data.connected ?? 0,
            total: data.total ?? 0,
            allOpenSourcesActive: data.allOpenSourcesActive ?? false,
          });
        }
      })
      .catch(() => { /* silent – status row shows nothing if fetch fails */ });
    return () => { cancelled = true; };
  }, []);

  const auditRows = useMemo(() => {
    return [...plan.auditTrail]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, MAX_AUDIT_ROWS);
  }, [plan.auditTrail]);

  const computedCompliance = useMemo(() => {
    const gateWeight = 40;
    const moduleWeight = 25;
    const documentWeight = 20;
    const carbonWeight = 15;

    const gatePart = totalRequiredGates > 0 ? (passedRequiredGates / totalRequiredGates) * gateWeight : 0;
    const modulePart = totalModules > 0 ? (readyModules / totalModules) * moduleWeight : 0;
    const documentPart = totalDocs > 0 ? (verifiedDocs / totalDocs) * documentWeight : 0;
    const carbonPart = carbonReady ? carbonWeight : 0;

    return Math.round(gatePart + modulePart + documentPart + carbonPart);
  }, [totalRequiredGates, passedRequiredGates, totalModules, readyModules, totalDocs, verifiedDocs, carbonReady]);

  const complianceScore = plan.complianceScore > 0 ? plan.complianceScore : computedCompliance;
  const scoreCircle = useMemo(() => {
    const r = 40;
    const c = 2 * Math.PI * r;
    const ratio = Math.max(0, Math.min(100, complianceScore)) / 100;
    return {
      circumference: c,
      dashOffset: c * (1 - ratio),
    };
  }, [complianceScore]);

  const locationText = plan.location.propertyId || plan.location.address || 'Ej angiven fastighet';
  const hasRemoteSession = remoteSync.enabled && Boolean(remoteSync.projectId);

  if (mode === 'score') {
    return (
      <div className="animate-in fade-in duration-500 space-y-8">
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_2fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Regelefterlevnadspoäng</p>
            <div className="mt-4 flex items-center justify-center">
              <div className="relative h-48 w-48">
                <svg className="h-full w-full" viewBox="0 0 100 100">
                  <circle className="stroke-slate-200" strokeWidth="10" fill="transparent" r="40" cx="50" cy="50" />
                  <circle
                    className="stroke-emerald-500"
                    strokeWidth="10"
                    strokeLinecap="round"
                    fill="transparent"
                    r="40"
                    cx="50"
                    cy="50"
                    strokeDasharray={scoreCircle.circumference}
                    strokeDashoffset={scoreCircle.dashOffset}
                    transform="rotate(-90 50 50)"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-5xl font-black tracking-tight text-slate-900">{complianceScore}</p>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-black">/100</p>
                </div>
              </div>
            </div>
            <p className="mt-4 text-xs text-slate-600">
              Poängen baseras på kontrollpunkter, modulberedskap, verifierade dokument och koldioxidstatus.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Kontrollpunkter</p>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <MiniKpi label="Gates passerade" value={`${passedRequiredGates}/${totalRequiredGates}`} />
              <MiniKpi label="Blockerade gates" value={String(blockedRequiredGates)} tone={blockedRequiredGates > 0 ? 'warn' : 'ok'} />
              <MiniKpi label="Moduler redo" value={`${readyModules}/${totalModules}`} />
              <MiniKpi label="Dokument verifierade" value={`${verifiedDocs}/${totalDocs}`} />
              <MiniKpi label="Koldioxidstatus" value={carbonReady ? 'REDO' : 'SAKNAS'} tone={carbonReady ? 'ok' : 'warn'} />
              <MiniKpi label="Sampling checklista" value={`${samplingDone}/${samplingTotal}`} />
            </div>

            {plan.predictiveScores && (
              <div className="mt-8 border-t border-slate-100 pt-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Prediktiva Insikter</p>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Rating (Finans)</p>
                    <p className={`text-3xl font-black mt-1 ${['AAA', 'AA', 'A'].includes(plan.predictiveScores.fundingRisk.rating) ? 'text-emerald-600' : 'text-amber-600'
                      }`}>
                      {plan.predictiveScores.fundingRisk.rating}
                    </p>
                    <p className="text-[9px] text-slate-500 mt-1 uppercase font-bold">
                      {plan.predictiveScores.fundingRisk.eligibleForGreenLoan ? 'Lämplig för Grönt Lån' : 'Kräver extra säkerhet'}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Regulatorisk Risk</p>
                    <p className="text-3xl font-black mt-1 text-slate-900">
                      {Math.round(plan.predictiveScores.regulatoryRisk.probabilityRfi * 100)}%
                    </p>
                    <p className="text-[9px] text-slate-500 mt-1 uppercase font-bold">Sannolhet för komplettering</p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Miljöindex</p>
                    <p className="text-3xl font-black mt-1 text-slate-900">
                      {Math.round(plan.predictiveScores.environmentalRisk.score * 100)}/100
                    </p>
                    <p className="text-[9px] text-slate-500 mt-1 uppercase font-bold">Geospatial sårbarhet</p>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-[10px] uppercase font-black text-slate-400 mb-2">Riskfaktorer baserat på historik</p>
                  <div className="flex flex-wrap gap-2">
                    {plan.predictiveScores.regulatoryRisk.topRiskFactors.map((factor, i) => (
                      <span key={i} className="px-2 py-1 bg-amber-50 text-amber-800 text-[10px] font-bold rounded-lg border border-amber-100">
                        {factor}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (mode === 'audit') {
    return (
      <div className="animate-in fade-in duration-500 space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Audit trail</p>
          <h2 className="mt-2 text-2xl font-black text-slate-900">Sparbar handelselogg</h2>
          <p className="mt-2 text-sm text-slate-600">
            Visar de senaste {MAX_AUDIT_ROWS} handelserna i projektets audit trail.
          </p>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-sm">
          <div className="space-y-3">
            {auditRows.map((row) => (
              <AuditRow
                key={row.id}
                time={new Date(row.timestamp).toLocaleString('sv-SE')}
                user={row.user}
                action={row.action}
                details={row.details}
              />
            ))}
            {auditRows.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-700 px-4 py-3 text-xs text-slate-400">
                Ingen audit-data registrerad an.
              </p>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (mode === 'reports') {
    return (
      <div className="animate-in fade-in duration-500 space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Langivarerapport</p>
          <h2 className="mt-2 text-2xl font-black text-slate-900">Risk- och genomforandestatus</h2>
          <p className="mt-2 text-sm text-slate-600">
            Sammanfattning for extern rapportering, baserad pa aktuell projektplan.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Projektstatus</h3>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <p>Projekt: <span className="font-bold text-slate-900">{plan.name || 'Ej namnsatt'}</span></p>
              <p>Fastighet/plats: <span className="font-bold text-slate-900">{locationText}</span></p>
              <p>Mall: <span className="font-bold text-slate-900">{plan.templateId}</span></p>
              <p>Revisionsid: <span className="font-bold text-slate-900">{plan.revision}</span></p>
              <p>Remote sync: <span className={`font-bold ${hasRemoteSession ? 'text-emerald-700' : 'text-amber-700'}`}>{hasRemoteSession ? 'AKTIV' : 'LOKAL FALLBACK'}</span></p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Nyckeltal</h3>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniKpi label="Regelefterlevnad" value={`${complianceScore}/100`} />
              <MiniKpi label="Gates genomförda" value={`${gateCompletionPct}%`} />
              <MiniKpi label="Verifierade dokument" value={String(verifiedDocs)} />
              <MiniKpi label="Koldioxid" value={carbonReady ? `${carbonResult?.totalKgCo2e.toFixed(1)} kg` : 'SAKNAS'} tone={carbonReady ? 'ok' : 'warn'} />
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Prediktiv Riskprofil</h3>
            <div className="mt-4 space-y-3">
              <StatusRow label="Finansiell Rating" value={plan.predictiveScores?.fundingRisk.rating || 'N/A'} />
              <StatusRow label="Risk för komplettering" value={`${Math.round((plan.predictiveScores?.regulatoryRisk.probabilityRfi || 0) * 100)}%`} warn={(plan.predictiveScores?.regulatoryRisk.probabilityRfi || 0) > 0.4} />
              <StatusRow label="Grundvattenrisk" value={plan.predictiveScores?.environmentalRisk.groundwaterImpact ? 'HÖG' : 'LÅG'} warn={plan.predictiveScores?.environmentalRisk.groundwaterImpact > 0.5} />
              <StatusRow label="Föreläggandersrisk" value={`${Math.round((plan.predictiveScores?.regulatoryRisk.probabilityInjunction || 0) * 100)}%`} />
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Verkställande överblick</p>
            <h1 className="mt-1 text-3xl font-black text-slate-900">Projekt- och compliancesammanfattning</h1>
            <p className="mt-2 text-sm text-slate-600">
              {plan.name || 'Namnlost projekt'} | {locationText}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600">
            DB sync: {hasRemoteSession ? 'AKTIV' : 'LOKAL'} {remoteSync.projectId ? `(${remoteSync.projectId})` : ''}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Regelefterlevnadspoäng" value={`${complianceScore}/100`} />
        <KpiCard label="Gates godkända" value={`${passedRequiredGates}/${totalRequiredGates}`} />
        <KpiCard label="Modulberedskap" value={`${readyModules}/${totalModules}`} />
        <KpiCard label="Verifierade dokument" value={`${verifiedDocs}/${totalDocs}`} />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Systemstatus</h3>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            <StatusRow label="Gates genomförda" value={`${gateCompletionPct}%`} />
            <StatusRow label="Blockerade gates" value={String(blockedRequiredGates)} warn={blockedRequiredGates > 0} />
            <StatusRow label="Utkastdokument" value={String(draftDocs)} warn={draftDocs > 0} />
            <StatusRow label="Arkiverade dokument" value={String(archivedDocs)} />
            <StatusRow label="Samplingschecklista" value={`${samplingDone}/${samplingTotal}`} />
            <StatusRow label="Koldioxidstatus" value={carbonReady ? 'REDO' : 'SAKNAS'} warn={!carbonReady} />
            {datasourceHealth !== null && (
              <StatusRow
                label="Externa datakällor"
                value={`${datasourceHealth.connected}/${datasourceHealth.total} aktiva`}
                warn={!datasourceHealth.allOpenSourcesActive}
              />
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Senaste granskningsposter</h3>
          <div className="mt-4 space-y-2">
            {auditRows.slice(0, 5).map((row) => (
              <div key={row.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                <p className="font-bold text-slate-800">{row.action}</p>
                <p className="text-slate-500">{new Date(row.timestamp).toLocaleString('sv-SE')} | {row.user}</p>
              </div>
            ))}
            {auditRows.length === 0 && <p className="text-xs text-slate-500">Ingen granskningsdata registrerad ännu.</p>}
          </div>
        </div>
      </section>
    </div>
  );
};

const KpiCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-black">{label}</p>
    <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
  </div>
);

const MiniKpi: React.FC<{ label: string; value: string; tone?: 'default' | 'ok' | 'warn' }> = ({ label, value, tone = 'default' }) => {
  const toneClass =
    tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-slate-200 bg-slate-50 text-slate-800';

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-[0.12em] font-black opacity-70">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
};

const StatusRow: React.FC<{ label: string; value: string; warn?: boolean }> = ({ label, value, warn }) => (
  <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
    <span className="text-slate-600">{label}</span>
    <span className={`font-black ${warn ? 'text-amber-700' : 'text-slate-900'}`}>{value}</span>
  </div>
);

const AuditRow: React.FC<{ time: string; user: string; action: string; details: string }> = ({ time, user, action, details }) => (
  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-black">{action}</p>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300">{time}</p>
    </div>
    <p className="mt-1 text-xs text-slate-300">{details}</p>
    <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-blue-300">{user}</p>
  </div>
);

export default ExecutiveSummary;
