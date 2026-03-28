
import React, { useState } from 'react';
import GanttChart from './GanttChart';
import ProjectOrgChart from './ProjectOrgChart';
import ProjectPlanStructurePanel from './ProjectPlanStructurePanel';
import { CarbonInput, ProjectPlan } from '../types';
import { suggestStakeholders, generatePlanDraft } from '../services/geminiService';
import { DEFAULT_PHASES } from '../constants';
import { createArchiveDocument, getTemplatePacks } from '../services/projectStructure';
import { useProjectStructure } from './ProjectStructureContext';

interface ProjectManagerViewProps {
  activeTab: string;
}

const TEMPLATE_PACKS = getTemplatePacks();

const ProjectManagerView: React.FC<ProjectManagerViewProps> = ({ activeTab }) => {
  const {
    plan,
    setPlan,
    applyTemplatePack,
    evaluateGate,
    runCarbonCalculation,
    applyMapLayerRecommendation,
    loadPlanFromServer,
    savePlanToServer,
    remoteSync,
    gateStats,
  } = useProjectStructure();
  const [viewMode, setViewMode] = useState<'edit' | 'report'>('edit');
  const [isInitializing, setIsInitializing] = useState(false);

  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isDrafting, setIsDrafting] = useState<string | null>(null);
  const [permitType, setPermitType] = useState('');
  const [permitSubmitted, setPermitSubmitted] = useState(false);
  const [carbonInput, setCarbonInput] = useState<CarbonInput>({
    tons: 100,
    distanceKm: 12.5,
    manualDistanceKm: 0,
    transportMode: 'TRUCK',
    materialType: 'SOIL',
  });
  const [gateInfo, setGateInfo] = useState('');

  const fallbackDraft = (type: 'background' | 'description') => {
    if (type === 'background') {
      return `Projektet avser ${plan.name || 'aktuell verksamhet'} och drivs med fokus på spårbar riskhantering, verifierad dokumentation och tydlig myndighetsdialog.`;
    }
    return 'Genomförande sker i etapper med gate-styrning, dokumentkontroll och uppföljning av risk- och miljökrav.';
  };

  const handleUpdatePlan = <K extends keyof ProjectPlan,>(key: K, value: ProjectPlan[K]) => {
    setPlan((prev) => ({ ...prev, [key]: value }));
  };

  const handleApplyTemplate = async (templateId: string) => {
    await applyTemplatePack(templateId);
    await applyMapLayerRecommendation();
    setGateInfo(`Mall applicerad: ${templateId}`);
  };

  const handleEvaluateGates = async () => {
    const gateIds = plan.stageGates.map((gate) => gate.id);
    let changedCount = 0;
    for (const gateId of gateIds) {
      const result = await evaluateGate(gateId, {
        permitType,
        permitSubmitted,
        mapLayerAvailable: plan.mapLayerSelection.enabled,
      });
      if (result.changed) changedCount += 1;
    }
    setGateInfo(`Stage-gates utvärderade. Uppdaterade: ${changedCount}.`);
  };

  const handleCarbonRun = async () => {
    await runCarbonCalculation(carbonInput);
    const carbonGate = await evaluateGate('gate-CARBON_CHECK', {
      permitType,
      permitSubmitted,
      mapLayerAvailable: plan.mapLayerSelection.enabled,
      note: 'CO2 calculated in project panel.',
    });
    setGateInfo(`CO2 kalkyl klar. Carbon gate: ${carbonGate.status}.`);
  };

  const handleRecommendMapLayers = async () => {
    await applyMapLayerRecommendation();
    setGateInfo(`Kartlager rekommenderade för projekttyp ${plan.projectType}.`);
  };

  const handleLoadFromDb = async () => {
    await loadPlanFromServer();
    setGateInfo('Plan laddad från databas.');
  };

  const handleSaveToDb = async () => {
    await savePlanToServer();
    setGateInfo('Plan sparad till databas.');
  };

  const handleAutoStart = async () => {
    if (!plan.location.propertyId) return;
    setIsInitializing(true);

    // Simulate API calls to Lantmäteriet, Länsstyrelsen, SGU
    setTimeout(() => {
      setPlan(prev => ({
        ...prev,
        name: `VA-Utbyggnad ${prev.location.propertyId}`,
        background: `Projektet initierat för fastighet ${prev.location.propertyId}. Systemet har identifierat närhet till Natura 2000-område vilket kräver utökad miljökonsekvensbeskrivning.`,
        phases: DEFAULT_PHASES,
        stakeholders: [
          { id: '1', name: 'Nacka Kommun', role: 'Myndighet', relevance: 'Tillsynsmyndighet' },
          { id: '2', name: 'SGU', role: 'Expertstöd', relevance: 'Geoteknisk rådgivning' }
        ],
        auditTrail: [
          { id: 'A1', timestamp: new Date().toISOString(), user: 'System', action: 'Projekt skapat', details: `Automatisk uppstart via Fastighets-API för ${prev.location.propertyId}`, immutable: true }
        ],
        moduleIntegrations: prev.moduleIntegrations.map((item) =>
          item.module === 'PROJECT_MANAGER' || item.module === 'PERMIT_PORTAL'
            ? { ...item, readiness: 'READY' }
            : item
        ),
        documentArchive:
          prev.documentArchive.length > 0
            ? prev.documentArchive
            : [
              createArchiveDocument({
                name: `Projektinitiering-${prev.location.propertyId}`,
                module: 'PROJECT_MANAGER',
                category: 'PROJECT_PLAN',
                status: 'VERIFIED',
                tags: ['project_plan', 'autostart'],
              }),
            ]
      }));
      setIsInitializing(false);
    }, 2000);
  };

  const handleSignPhase = (phaseId: string) => {
    setPlan(prev => ({
      ...prev,
      phases: prev.phases.map(p => p.id === phaseId ? { ...p, status: 'DONE', isLocked: true } : p),
      auditTrail: [
        ...prev.auditTrail,
        { id: `A${Date.now()}`, timestamp: new Date().toISOString(), user: 'Projektledare', action: 'Fas Signerad', details: `Fas ${phaseId} godkänd och låst.`, immutable: true }
      ]
    }));
  };

  const handleAIDraft = async (type: 'background' | 'description') => {
    setIsDrafting(type);
    try {
      const draft = await generatePlanDraft(type, plan.name);
      handleUpdatePlan(type, draft || fallbackDraft(type));
      setGateInfo(`Utkast uppdaterat för ${type}.`);
    } catch (e) {
      console.error(e);
      handleUpdatePlan(type, fallbackDraft(type));
      setGateInfo(`AI-tjänst otillgänglig. Lokal fallback användes för ${type}.`);
    } finally {
      setIsDrafting(null);
    }
  };

  const handleGetStakeholders = async () => {
    setIsSuggesting(true);
    try {
      const suggestions = await suggestStakeholders(plan.location.address, plan.description);
      if (suggestions.length > 0) {
        handleUpdatePlan('stakeholders', suggestions);
        setGateInfo('Intressentlista uppdaterad.');
      } else {
        const fallback = [
          { id: `fb-${Date.now()}-1`, name: 'Kommunens miljöenhet', role: 'Tillsyn', relevance: 'Primär tillsynsmyndighet för ärendet.' },
          { id: `fb-${Date.now()}-2`, name: 'Länsstyrelsen', role: 'Regional samordning', relevance: 'Samordning av natur- och kulturintressen.' },
          { id: `fb-${Date.now()}-3`, name: 'Närboende/sakägare', role: 'Dialogpart', relevance: 'Berörda av buller, trafik och tidsplan.' },
        ];
        handleUpdatePlan('stakeholders', fallback);
        setGateInfo('Fallback-intressenter laddade.');
      }
    } catch (e) {
      console.error(e);
      const fallback = [
        { id: `fb-${Date.now()}-1`, name: 'Kommunens miljöenhet', role: 'Tillsyn', relevance: 'Primär tillsynsmyndighet för ärendet.' },
        { id: `fb-${Date.now()}-2`, name: 'Länsstyrelsen', role: 'Regional samordning', relevance: 'Samordning av natur- och kulturintressen.' },
      ];
      handleUpdatePlan('stakeholders', fallback);
      setGateInfo('AI otillgänglig. Lokal fallback för intressentanalys användes.');
    } finally {
      setIsSuggesting(false);
    }
  };

  const reportAccentColor = plan.branding.primaryColor || '#0f172a';
  const reportLogo =
    plan.branding.logoUrl?.trim() || '/logo.png';
  const completedSamplingSteps = plan.samplingPreparation.checklist.filter((item) => item.done).length;

  if (plan.phases.length === 0 && activeTab === 'plan') {
    return (
      <div className="max-w-2xl mx-auto mt-20 animate-in zoom-in duration-500">
        <div className="bg-white p-12 rounded-[3rem] border border-slate-200 shadow-2xl text-center space-y-8">
          <div className="w-24 h-24 bg-blue-600 rounded-[2rem] flex items-center justify-center text-white text-4xl mx-auto shadow-2xl shadow-blue-200">
            <i className="fas fa-rocket"></i>
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-black italic uppercase tracking-tight">Automatisk Projektuppstart</h2>
            <p className="text-slate-500 font-medium">Ange fastighetsbeteckning för att generera WBS, tidplan och intressentlista via API.</p>
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="T.ex. NACKA ORMINGE 7:8"
              className="w-full p-6 bg-slate-50 border-2 border-slate-100 rounded-3xl text-xl font-black uppercase tracking-widest text-center focus:border-blue-500 outline-none transition-all"
              value={plan.location.propertyId}
              onChange={(e) => handleUpdatePlan('location', { ...plan.location, propertyId: e.target.value })}
            />
          </div>
          <button
            onClick={handleAutoStart}
            disabled={!plan.location.propertyId || isInitializing}
            className="w-full py-6 bg-slate-900 text-white rounded-3xl text-sm font-black uppercase tracking-widest hover:bg-blue-600 transition-all shadow-xl disabled:opacity-50"
          >
            {isInitializing ? <i className="fas fa-spinner fa-spin mr-2"></i> : <i className="fas fa-bolt mr-2 text-yellow-400"></i>}
            {isInitializing ? 'Hämtar Myndighetsdata...' : 'Starta Projektmotor'}
          </button>
        </div>
      </div>
    );
  }

  if (viewMode === 'report') {
    return (
      <div className="max-w-4xl mx-auto bg-white p-20 shadow-2xl rounded-sm font-serif text-slate-900 min-h-screen animate-in fade-in duration-500 relative overflow-hidden">
        {/* Watermark */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] rotate-[-35deg] select-none">
          <span className="text-9xl font-black whitespace-nowrap uppercase">UTKAST – Kräver manuell verifiering</span>
        </div>

        <button onClick={() => setViewMode('edit')} className="fixed top-24 left-10 p-4 bg-slate-900 text-white rounded-full shadow-xl hover:scale-110 transition-all z-50">
          <i className="fas fa-arrow-left"></i>
        </button>
        <header className="border-b-4 border-slate-900 pb-10 mb-10" style={{ borderColor: reportAccentColor }}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Projektstyrdokument / {plan.revision}</p>
          <h1 className="text-5xl font-black tracking-tighter uppercase">{plan.name}</h1>
          <div className="mt-6 flex justify-between items-end">
            <div>
              <p className="text-sm font-black">{plan.branding.organizationName}</p>
              <p className="text-sm font-bold">Fastighet: {plan.location.propertyId}</p>
              <p className="text-xs text-slate-500 uppercase tracking-widest">Layout: {plan.branding.layoutTemplate}</p>
              <p className="text-sm text-slate-400 italic">Skapat: {new Date().toLocaleDateString('sv-SE')}</p>
            </div>
            <img src={reportLogo} className="h-10 grayscale opacity-20" alt="Logo" />
          </div>
        </header>

        <section className="mb-12">
          <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">1. Bakgrund & Behov</h2>
          <p className="text-lg leading-relaxed">{plan.background}</p>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">2. Projektbeskrivning</h2>
          <p className="text-lg leading-relaxed whitespace-pre-wrap">{plan.description}</p>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">3. Effektmål</h2>
          <ul className="list-disc pl-6 space-y-2">
            {plan.goals.map(g => <li key={g.id} className="text-lg font-bold italic">{g.text}</li>)}
          </ul>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">4. Intressentanalys</h2>
          <div className="grid grid-cols-2 gap-6">
            {plan.stakeholders.map(s => (
              <div key={s.id} className="p-4 border border-slate-100 bg-slate-50">
                <p className="text-[10px] font-black uppercase opacity-50">{s.role}</p>
                <p className="font-bold">{s.name}</p>
                <p className="text-sm italic mt-1">{s.relevance}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">5. Dokumentarkiv</h2>
          <div className="space-y-3">
            {plan.documentArchive.map((doc) => (
              <div key={doc.id} className="p-4 border border-slate-100 bg-slate-50">
                <p className="font-bold">{doc.name}</p>
                <p className="text-xs uppercase tracking-widest text-slate-500">
                  {doc.module} / {doc.category} / {doc.status}
                </p>
                <p className="text-xs font-mono text-slate-500 mt-1">{doc.storagePath}</p>
              </div>
            ))}
            {plan.documentArchive.length === 0 && (
              <p className="text-sm text-slate-500 italic">Inga dokument registrerade.</p>
            )}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">6. Förberedd Provtagning</h2>
          <p className="text-sm font-bold">
            Aktiverad: {plan.samplingPreparation.enabled ? 'Ja' : 'Nej'} | Förberedelse behov nu:{' '}
            {plan.samplingPreparation.requiresPreparationNow ? 'Ja' : 'Nej'}
          </p>
          <p className="text-sm mt-2">
            Checklista: {completedSamplingSteps}/{plan.samplingPreparation.checklist.length} klara.
          </p>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-black uppercase mb-4 border-b border-slate-200 pb-2">7. Stage-gates och CO2</h2>
          <p className="text-sm font-bold">
            Projekttyp: {plan.projectType} | Mall: {plan.templateId}
          </p>
          <div className="mt-3 space-y-2">
            {plan.stageGates.map((gate) => (
              <div key={gate.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm">
                <span className="font-semibold uppercase">{gate.type}</span>
                <span className="font-bold">{gate.status}</span>
              </div>
            ))}
          </div>
          {plan.carbonSummary.lastResult && (
            <p className="text-sm mt-3">
              Senaste CO2: <span className="font-bold">{plan.carbonSummary.lastResult.totalKgCo2e.toFixed(2)} kgCO2e</span>{' '}
              ({plan.carbonSummary.lastResult.quality})
            </p>
          )}
        </section>

        <footer className="mt-20 pt-10 border-t border-slate-100 text-center text-xs text-slate-400">
          Dokumentet är genererat via Miljöintelligens.se AI Engine. Version 5.0.
        </footer>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-10 pb-20">
      {activeTab === 'plan' && (
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="bg-white p-10 md:p-16 rounded-[3rem] border border-slate-200 shadow-sm space-y-12">
            <header className="flex justify-between items-end border-b border-slate-100 pb-10">
              <div className="space-y-4 flex-1">
                <input
                  className="text-4xl font-black text-slate-900 tracking-tighter italic bg-transparent border-none outline-none focus:ring-0 w-full"
                  value={plan.name}
                  onChange={(e) => handleUpdatePlan('name', e.target.value)}
                  placeholder="Projektnamn..."
                />
                <input
                  className="text-xs font-bold text-slate-400 not-italic uppercase tracking-[0.2em] bg-transparent border-none outline-none focus:ring-0"
                  value={plan.revision}
                  onChange={(e) => handleUpdatePlan('revision', e.target.value)}
                  placeholder="Revision / Utgåva..."
                />
              </div>
              <button
                onClick={() => setViewMode('report')}
                className="px-6 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl flex items-center gap-2 hover:bg-blue-600 transition-all"
              >
                <i className="fas fa-file-pdf"></i> Sammanställ Styrdokument
              </button>
            </header>

            <section className="space-y-6">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className="space-y-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Mallmotor (Set A)</p>
                    <select
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
                      value={plan.templateId}
                      onChange={(e) => void handleApplyTemplate(e.target.value)}
                    >
                      {TEMPLATE_PACKS.map((pack) => (
                        <option key={pack.id} value={pack.id}>
                          {pack.name} ({pack.projectType})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-600">Aktiv projekttyp: <span className="font-bold">{plan.projectType}</span></p>
                  </div>

                  <div className="space-y-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Tillståndsgate</p>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      placeholder="Permit type (t.ex. Anmälan 9 kap)"
                      value={permitType}
                      onChange={(e) => setPermitType(e.target.value)}
                    />
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <input type="checkbox" checked={permitSubmitted} onChange={(e) => setPermitSubmitted(e.target.checked)} />
                      Permit submitted
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleEvaluateGates()}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-600"
                    >
                      Utvärdera gates
                    </button>
                    <p className="text-xs text-slate-600">
                      Gates: {gateStats.passed} passed / {gateStats.blocked} blocked
                    </p>
                  </div>
                </div>

                <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">DB sync</p>
                      <p className="text-xs text-slate-600">
                        {remoteSync.enabled ? `Aktiv projektkoppling: ${remoteSync.projectId}` : 'Ingen aktiv API-session (token/projectId saknas).'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleLoadFromDb()}
                        disabled={remoteSync.syncing}
                        className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-700 disabled:opacity-60"
                      >
                        {remoteSync.syncing ? '...' : 'Ladda DB-plan'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveToDb()}
                        disabled={remoteSync.syncing || !remoteSync.enabled}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-600 disabled:opacity-60"
                      >
                        {remoteSync.syncing ? '...' : 'Spara DB-plan'}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                    {remoteSync.lastLoadedAt && <span>Load: {new Date(remoteSync.lastLoadedAt).toLocaleString('sv-SE')}</span>}
                    {remoteSync.lastSavedAt && <span>Save: {new Date(remoteSync.lastSavedAt).toLocaleString('sv-SE')}</span>}
                    {remoteSync.error && <span className="font-semibold text-rose-600">{remoteSync.error}</span>}
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-4">
                  <input
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    type="number"
                    min={0}
                    value={carbonInput.tons}
                    onChange={(e) => setCarbonInput((prev) => ({ ...prev, tons: Number(e.target.value || 0) }))}
                    placeholder="Tons"
                  />
                  <input
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    type="number"
                    min={0}
                    value={carbonInput.distanceKm || 0}
                    onChange={(e) => setCarbonInput((prev) => ({ ...prev, distanceKm: Number(e.target.value || 0) }))}
                    placeholder="Rutt distans (km)"
                  />
                  <select
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
                    value={carbonInput.transportMode}
                    onChange={(e) =>
                      setCarbonInput((prev) => ({
                        ...prev,
                        transportMode: e.target.value as CarbonInput['transportMode'],
                      }))
                    }
                  >
                    <option value="TRUCK">TRUCK</option>
                    <option value="RAIL">RAIL</option>
                    <option value="SHIP">SHIP</option>
                  </select>
                  <select
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
                    value={carbonInput.materialType}
                    onChange={(e) =>
                      setCarbonInput((prev) => ({
                        ...prev,
                        materialType: e.target.value as CarbonInput['materialType'],
                      }))
                    }
                  >
                    <option value="SOIL">SOIL</option>
                    <option value="ROCK">ROCK</option>
                    <option value="WASTE">WASTE</option>
                    <option value="MIXED">MIXED</option>
                  </select>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCarbonRun()}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-700"
                  >
                    Kör CO2-kalkyl
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRecommendMapLayers()}
                    className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-100"
                  >
                    Rekommendera kartlager
                  </button>
                  {plan.carbonSummary.lastResult && (
                    <p className="text-xs font-semibold text-slate-700">
                      Senaste: {plan.carbonSummary.lastResult.totalKgCo2e.toFixed(2)} kgCO2e ({plan.carbonSummary.lastResult.quality})
                    </p>
                  )}
                  {gateInfo && <p className="text-xs text-slate-600">{gateInfo}</p>}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {plan.stageGates.map((gate) => (
                    <div key={gate.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                      <p className="font-black uppercase text-slate-700">{gate.type}</p>
                      <p className="text-slate-600">Status: <span className="font-bold">{gate.status}</span></p>
                      {gate.reason && <p className="text-slate-500">{gate.reason}</p>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Bakgrund & Behov</label>
                    <button onClick={() => handleAIDraft('background')} disabled={!!isDrafting} className="text-[9px] font-black text-blue-600 uppercase hover:underline">
                      {isDrafting === 'background' ? 'Skriver...' : 'Få AI-utkast'}
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    className="w-full p-6 bg-slate-50 rounded-3xl border border-slate-200 text-sm text-slate-700 leading-relaxed italic outline-none focus:ring-4 focus:ring-blue-500/5 transition-all"
                    value={plan.background}
                    onChange={(e) => handleUpdatePlan('background', e.target.value)}
                  />
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Projektbeskrivning</label>
                    <button onClick={() => handleAIDraft('description')} disabled={!!isDrafting} className="text-[9px] font-black text-blue-600 uppercase hover:underline">
                      {isDrafting === 'description' ? 'Skriver...' : 'Få AI-utkast'}
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    className="w-full p-6 bg-slate-50 rounded-3xl border border-slate-200 text-sm text-slate-700 leading-relaxed outline-none focus:ring-4 focus:ring-blue-500/5 transition-all"
                    value={plan.description}
                    onChange={(e) => handleUpdatePlan('description', e.target.value)}
                  />
                </div>
              </div>

              <ProjectPlanStructurePanel plan={plan} onUpdatePlan={handleUpdatePlan} />

              {/* Stop Gates / Phases */}
              <div className="pt-10 space-y-6">
                <h4 className="text-xl font-black text-slate-900 italic tracking-tight">Ansvars-spärrar (Stop Gates)</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {plan.phases.map((phase) => (
                    <div key={phase.id} className={`p-6 rounded-3xl border transition-all ${phase.status === 'DONE' ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-100'
                      }`}>
                      <div className="flex justify-between items-start mb-4">
                        <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${phase.status === 'DONE' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'
                          }`}>
                          {phase.status}
                        </span>
                        {phase.requiresSignature && phase.status !== 'DONE' && (
                          <i className="fas fa-signature text-amber-500"></i>
                        )}
                      </div>
                      <h5 className="font-black text-slate-800 text-sm mb-2">{phase.title}</h5>
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-4">{phase.tasks.length} Uppgifter</p>

                      {phase.requiresSignature && phase.status !== 'DONE' ? (
                        <button
                          onClick={() => handleSignPhase(phase.id)}
                          className="w-full py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all"
                        >
                          Signera & Lås Fas
                        </button>
                      ) : phase.status !== 'DONE' ? (
                        <button className="w-full py-3 bg-slate-100 text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-widest cursor-not-allowed">
                          Väntar på uppgifter
                        </button>
                      ) : (
                        <div className="flex items-center justify-center gap-2 text-emerald-600 text-[10px] font-black uppercase">
                          <i className="fas fa-check-double"></i> Verifierad
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-10 space-y-6">
                <div className="flex justify-between items-center">
                  <h4 className="text-xl font-black text-slate-900 italic tracking-tight">Intressentanalys</h4>
                  <button
                    onClick={handleGetStakeholders}
                    disabled={isSuggesting}
                    className="px-6 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                  >
                    {isSuggesting ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-users-viewfinder"></i>}
                    {isSuggesting ? 'Analyserar...' : 'Föreslå Intressenter'}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {plan.stakeholders.map((s) => (
                    <div key={s.id} className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm hover:border-indigo-200 transition-all group">
                      <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">{s.role}</p>
                      <p className="font-black text-slate-800 mb-2">{s.name}</p>
                      <p className="text-[11px] text-slate-500 leading-relaxed italic">{s.relevance}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
          <ProjectOrgChart />
        </div>
      )}

      {activeTab === 'timeline' && <GanttChart phases={plan.phases} />}

      {activeTab === 'risks' && (
        <div className="bg-white p-10 rounded-[3rem] border border-slate-200 shadow-sm overflow-hidden max-w-5xl mx-auto">
          <header className="mb-10 flex justify-between items-center">
            <div>
              <h3 className="text-2xl font-black text-slate-900 italic">Riskhanteringsplan</h3>
              <p className="text-sm text-slate-500 mt-1">Sannolikhet (1-5) x Konsekvens (1-5)</p>
            </div>
            <button className="px-6 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest">Ny Risk</button>
          </header>
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400">
              <tr>
                <th className="px-6 py-4">Riskfaktor</th>
                <th className="px-6 py-4 text-center">Risknivå</th>
                <th className="px-6 py-4">Åtgärd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              <tr className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 font-bold text-slate-700">Oväntade markförhållanden</td>
                <td className="px-6 py-4 text-center">
                  <span className="px-3 py-1 bg-rose-50 text-rose-700 rounded-full text-[10px] font-black uppercase border border-rose-100">Allvarlig</span>
                </td>
                <td className="px-6 py-4 text-slate-600 italic">Kompletterande geoteknik</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ProjectManagerView;

