import React, { useMemo, useState } from 'react';
import MapView from './MapView';
import { Permit, PermitCodeProfile, WasteCode } from '../types';
import WeatherRisk from './WeatherRisk';
import { WASTE_CODES } from '../constants';
import { useProjectStructure } from './ProjectStructureContext';
import { applyPermitCodeSelection } from '../services/projectStructure';

interface PermitPortalViewProps {
  permits: Permit[];
  mode?: 'map' | 'apply';
}

const PermitPortalView: React.FC<PermitPortalViewProps> = ({ permits, mode = 'map' }) => {
  const { plan, setPlan, addArchiveDocument, evaluateGate, markModuleReady } = useProjectStructure();
  const [selectedMuni, setSelectedMuni] = useState('Haninge');
  const [selectedCode, setSelectedCode] = useState<WasteCode | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<PermitCodeProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draftSyncInfo, setDraftSyncInfo] = useState('');
  const [permitSubmitted, setPermitSubmitted] = useState(false);

  const municipalities = useMemo(() => Array.from(new Set(permits.map((permit) => permit.municipality))).sort(), [permits]);

  const filteredCodes = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return WASTE_CODES.filter((code) => code.code.toLowerCase().includes(q) || code.name.toLowerCase().includes(q));
  }, [searchQuery]);

  const applySelectedCodeProfile = (code: WasteCode) => {
    const applied = applyPermitCodeSelection(plan, {
      code: code.code,
      codeType: code.type,
      municipality: selectedMuni,
    });
    setPlan(applied.plan);
    setSelectedProfile(applied.profile);
    return applied;
  };

  const handleGenerateDraft = async () => {
    if (!selectedCode) return;
    const draftName = `Ansokningsutkast-${selectedMuni}-${selectedCode.code}`;
    const applied = applySelectedCodeProfile(selectedCode);

    addArchiveDocument({
      name: draftName,
      module: 'PERMIT_PORTAL',
      category: 'PERMIT',
      status: 'DRAFT',
      tags: ['application', selectedMuni.toLowerCase(), selectedCode.code.toLowerCase()],
    });
    markModuleReady('PERMIT_PORTAL', `Permit handoff active for ${selectedMuni} (${selectedCode.code}).`);
    setPermitSubmitted(false);
    const permitGate = await evaluateGate('gate-PERMIT_REQUIRED', {
      permitType: selectedCode.code,
      codeType: selectedCode.type,
      permitSubmitted: false,
      mapLayerAvailable: applied.plan.mapLayerSelection.enabled,
      note: 'Draft generated in permit portal.',
    });
    const riskGate = await evaluateGate('gate-RISK_REVIEW', {
      permitType: selectedCode.code,
      codeType: selectedCode.type,
      mapLayerAvailable: applied.plan.mapLayerSelection.enabled,
      note: 'Code profile synchronized for geofence checks.',
    });
    setDraftSyncInfo(
      `Synkad till projektplan: ${draftName}. Permit gate: ${permitGate.status}. Risk gate: ${riskGate.status}.`
    );
  };

  const handleMarkSubmitted = async () => {
    if (!selectedCode) return;
    const applied = applySelectedCodeProfile(selectedCode);
    setPermitSubmitted(true);
    const permitGate = await evaluateGate('gate-PERMIT_REQUIRED', {
      permitType: selectedCode.code,
      codeType: selectedCode.type,
      permitSubmitted: true,
      mapLayerAvailable: applied.plan.mapLayerSelection.enabled,
      note: 'Permit marked as submitted from portal.',
    });
    const riskGate = await evaluateGate('gate-RISK_REVIEW', {
      permitType: selectedCode.code,
      codeType: selectedCode.type,
      mapLayerAvailable: applied.plan.mapLayerSelection.enabled,
      note: 'Risk review re-evaluated after permit submission.',
    });
    setDraftSyncInfo(
      `Tillstand markerat som inskickat. Permit gate: ${permitGate.status}. Risk gate: ${riskGate.status}.`
    );
  };

  if (mode === 'apply') {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Ansokningsportal</p>
          <h2 className="mt-2 text-2xl font-black text-slate-900 md:text-3xl">Skapa juridiskt trygg ansokan med smart kodvaljare</h2>
          <p className="mt-3 max-w-3xl text-sm text-slate-600">
            Valj verksamhetskod, kontrollera lagkrav och bygg ett sparbart ansokningsutkast med tydlig kallhanvisning.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_1fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Steg 1</p>
                <h3 className="text-xl font-black text-slate-900">Kodvaljare (SNI och EWC)</h3>
              </div>
              <div className="w-full sm:w-56">
                <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Kommun</label>
                <select
                  value={selectedMuni}
                  onChange={(event) => setSelectedMuni(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800"
                >
                  {municipalities.map((municipality) => (
                    <option key={municipality} value={municipality}>
                      {municipality}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="relative mb-4">
              <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Sok kod eller verksamhet"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-blue-200"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {filteredCodes.map((code) => (
                <button
                  key={code.code}
                  type="button"
                  onClick={() => {
                    setSelectedCode(code);
                    const applied = applySelectedCodeProfile(code);
                    setDraftSyncInfo(
                      `Kodprofil synkad: ${applied.profile.regulatoryTrack}. Human legal review required before submission.`
                    );
                  }}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedCode?.code === code.code
                      ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                      : 'border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:bg-blue-50'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${
                        selectedCode?.code === code.code ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {code.type}
                    </span>
                    <span className="font-mono text-sm font-bold">{code.code}</span>
                  </div>
                  <p className="text-sm font-bold">{code.name}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-white shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-black">Steg 2</p>
            <h3 className="mt-2 text-xl font-black">Krav och regelkontroll</h3>

            {selectedCode ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-blue-300 font-black">Checklista</p>
                  <div className="mt-3 space-y-3">
                    <ChecklistItem label="Lagringstid" value={selectedCode.requirements.storageTime || 'Ej specificerat'} reference={selectedCode.requirements.legalReference} />
                    <ChecklistItem label="Maxmangd" value={selectedCode.requirements.maxAmount || 'Ej begransad'} reference={selectedCode.requirements.legalReference} />
                    <ChecklistItem label="Skyddsavstand" value={selectedCode.requirements.safetyDistance || 'Standardkrav'} reference={selectedCode.requirements.legalReference} />
                  </div>
                </div>

                <div className="rounded-2xl border border-blue-500/25 bg-blue-500/15 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-blue-300 font-black">AI-insikt</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-200">
                    For kod {selectedCode.code} i {selectedMuni} visar historiska beslut hog bifallsgrad nar invallning, loggning och tydlig kontrollplan bifogas.
                  </p>
                </div>

                {selectedProfile && (
                  <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200 font-black">MPF-profil</p>
                    <p className="mt-2 text-sm text-amber-100">
                      Spar: <span className="font-black">{selectedProfile.regulatoryTrack}</span> | Riskniva:{' '}
                      <span className="font-black">{selectedProfile.riskTier}</span> | Tidsbuffert:{' '}
                      <span className="font-black">{selectedProfile.timelineBufferWeeks} vecka(or)</span>
                    </p>
                    <p className="mt-2 text-xs text-amber-100/90">
                      Geofence-lager: {selectedProfile.requiredMapLayers.join(', ') || 'Inga extra lager'}.
                    </p>
                    {selectedProfile.thresholdTon !== null && (
                      <p className="mt-1 text-xs text-amber-100/90">
                        Traskel: {selectedProfile.thresholdTon} ton ({selectedProfile.thresholdScope}).
                      </p>
                    )}
                    <p className="mt-2 text-xs text-amber-100">{selectedProfile.reviewNote}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleGenerateDraft()}
                  className="w-full rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-100"
                >
                  Generera ansokningsutkast
                </button>
                <button
                  type="button"
                  onClick={() => void handleMarkSubmitted()}
                  disabled={!selectedCode}
                  className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-black text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                >
                  Markera tillstand inskickat
                </button>
                {permitSubmitted && <p className="text-xs text-blue-200">Tillstand markerat som inskickat.</p>}
                {draftSyncInfo && <p className="text-xs text-blue-200">{draftSyncInfo}</p>}
              </div>
            ) : (
              <div className="mt-12 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
                <i className="fas fa-arrow-left text-xl" />
                <p className="mt-3 text-sm font-semibold">Valj en kod i listan for att lasa krav och skapa underlag.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Portal overview</p>
        <h2 className="mt-2 text-2xl font-black text-slate-900 md:text-3xl">Kartbaserad tillstandsvy med riskstod</h2>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Kombinera vader, biodiversitet och geografiska lager for snabb bedomning innan ansokan skickas.
        </p>
      </section>

      <WeatherRisk municipality={selectedMuni} />

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4 md:flex md:items-center md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Karta</p>
            <h3 className="text-lg font-black text-slate-900">Interaktiv kartutforskare</h3>
          </div>
          <div className="mt-3 w-full md:mt-0 md:w-56">
            <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-black">Kommun</label>
            <select
              value={selectedMuni}
              onChange={(event) => setSelectedMuni(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800"
            >
              {municipalities.map((municipality) => (
                <option key={municipality} value={municipality}>
                  {municipality}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="h-[420px] md:h-[620px]">
          <MapView permits={permits} onSelectPermit={() => undefined} />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-white shadow-sm md:flex md:items-center md:justify-between md:gap-8">
        <div className="flex items-start gap-4">
          <div className="mt-1 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-blue-500/30 bg-blue-500/15 text-blue-300">
            <i className="fas fa-satellite-dish" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-black">Data fusion</p>
            <h4 className="mt-1 text-lg font-black">Spatial AI engine aktiv</h4>
            <p className="mt-2 text-sm text-slate-300">
              Lantmateriet, SLU och SMHI underlag sammanfogas till ett gemensamt beslutslager med tydlig prioritering av risker.
            </p>
          </div>
        </div>
        <button type="button" className="mt-4 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] md:mt-0">
          Exportera spatial audit
        </button>
      </section>
    </div>
  );
};

const ChecklistItem: React.FC<{ label: string; value: string; reference: string }> = ({ label, value, reference }) => (
  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-300">{label}</p>
      <span className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold text-blue-100">{reference}</span>
    </div>
    <p className="mt-2 text-sm font-semibold text-white">{value}</p>
  </div>
);

export default PermitPortalView;
