import React, { useCallback, useEffect, useState } from 'react';
import type { ProjectPlan } from '../../types';

interface ProjectScoringDashboardProps {
  projectId: string;
  token: string;
}

const ProjectScoringDashboard: React.FC<ProjectScoringDashboardProps> = ({ projectId, token }) => {
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadPlan = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const resp = await fetch(`/api/projects/${projectId}/plan`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await resp.json();
      if (!resp.ok || !json.ok) throw new Error(json.error || 'Kunde inte hämta projektplan');
      setPlan(json.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ett fel uppstod');
    } finally {
      setBusy(false);
    }
  }, [projectId, token]);

  useEffect(() => {
    if (projectId && token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadPlan();
    } else {
      setPlan(null);
    }
  }, [projectId, token, loadPlan]);

  if (!projectId) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 p-12 text-center text-slate-500">
        <p className="text-sm font-medium">Välj ett projekt i admin-panelen för att se scoring-detaljer.</p>
      </div>
    );
  }

  if (busy) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
        <p className="mt-4 text-sm font-bold text-slate-600">Beräknar bank-scoring...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">
        <p className="text-sm font-bold">Fel vid laddning:</p>
        <p className="mt-1 text-xs opacity-80">{error}</p>
        <button
          onClick={loadPlan}
          className="mt-4 rounded-xl bg-red-800 px-4 py-2 text-xs font-bold text-white hover:bg-red-900"
        >
          Försök igen
        </button>
      </div>
    );
  }

  if (!plan) return null;

  const scores = plan.predictiveScores;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {/* ── Main Score Card ── */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">
              Övergripande Compliance
            </p>
            <h3 className="text-lg font-black text-slate-900">{plan.name}</h3>
          </div>
          <div className="text-right">
            <span
              className={`inline-flex rounded-2xl px-4 py-2 text-3xl font-black ${
                plan.complianceScore >= 80
                  ? 'bg-emerald-100 text-emerald-800'
                  : plan.complianceScore >= 50
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-red-100 text-red-800'
              }`}
            >
              {plan.complianceScore}%
            </span>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-[10px] uppercase font-black text-slate-500">Bankvärdering</p>
            <p
              className={`mt-1 text-4xl font-black ${
                scores?.fundingRisk.rating.startsWith('A')
                  ? 'text-emerald-600'
                  : scores?.fundingRisk.rating.startsWith('B')
                    ? 'text-amber-600'
                    : 'text-red-600'
              }`}
            >
              {scores?.fundingRisk.rating || 'N/A'}
            </p>
            <p className="mt-2 text-[10px] text-slate-400">Baserat på Basel III simulering</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-[10px] uppercase font-black text-slate-500">Grön Finansiering</p>
            <p className="mt-1 text-xl font-black text-slate-800">
              {scores?.fundingRisk.eligibleForGreenLoan ? 'BERÄTTIGAD' : 'EJ BERÄTTIGAD'}
            </p>
            <div className={`mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden`}>
              <div
                className={`h-full transition-all ${scores?.fundingRisk.eligibleForGreenLoan ? 'bg-emerald-500 w-full' : 'bg-slate-300 w-1/3'}`}
              />
            </div>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-[10px] uppercase font-black text-slate-500 mb-2">AI-genererade riskfaktorer</p>
          <div className="flex flex-wrap gap-2">
            {scores?.regulatoryRisk.topRiskFactors.map((factor, i) => (
              <span
                key={i}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
              >
                ⚠️ {factor}
              </span>
            ))}
            {scores?.regulatoryRisk.topRiskFactors.length === 0 && (
              <span className="text-xs text-slate-400 italic">Inga kritiska riskfaktorer identifierade.</span>
            )}
          </div>
        </div>
      </section>

      {/* ── Detailed Risk Breakdown ── */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Riskfördelning</p>

        <div className="mt-6 space-y-6">
          {/* Regulatory Risk */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-bold">
              <span className="text-slate-700">Reguljär Risk (RFI/Föreläggande)</span>
              <span className="text-slate-900">{Math.round((scores?.regulatoryRisk.score || 0) * 100)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${(scores?.regulatoryRisk.score || 0) * 100}%` }}
              />
            </div>
            <div className="flex gap-4 text-[10px] text-slate-500">
              <span>RFI Prob: {Math.round((scores?.regulatoryRisk.probabilityRfi || 0) * 100)}%</span>
              <span>
                Injunction Prob: {Math.round((scores?.regulatoryRisk.probabilityInjunction || 0) * 100)}%
              </span>
            </div>
          </div>

          {/* Environmental Risk */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-bold">
              <span className="text-slate-700">Miljöpåverkan & Skyddsvärde</span>
              <span className="text-slate-900">
                {Math.round((scores?.environmentalRisk.score || 0) * 100)}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-teal-500 transition-all"
                style={{ width: `${(scores?.environmentalRisk.score || 0) * 100}%` }}
              />
            </div>
            <div className="flex gap-4 text-[10px] text-slate-500">
              <span>
                Grundvatten: {Math.round((scores?.environmentalRisk.groundwaterImpact || 0) * 100)}%
              </span>
              <span>
                Natura2000: {Math.round((scores?.environmentalRisk.biodiversityImpact || 0) * 100)}%
              </span>
              <span>Översvämning: {Math.round((scores?.environmentalRisk.floodingImpact || 0) * 100)}%</span>
            </div>
          </div>

          {/* Carbon Performance */}
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <div className="flex items-center gap-3">
              <span className="text-xl">🌱</span>
              <div>
                <p className="text-xs font-black text-emerald-900 uppercase tracking-wider">
                  Klimatprestanda
                </p>
                <p className="mt-1 text-[11px] text-emerald-700">
                  {plan.carbonSummary.lastResult
                    ? `Projektet har beräknat ${plan.carbonSummary.lastResult.totalKgCo2e} kg CO2e.`
                    : 'Klimatkalkyl saknas. Upprätta kalkyl för att förbättra funding-rating.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ProjectScoringDashboard;
