import React, { useState } from 'react';
import GanttChart from './GanttChart';
import ProjectOrgChart from './ProjectOrgChart';
import ProjectPlanStructurePanel from './ProjectPlanStructurePanel';
import type { ProjectPlan } from '../types';
import { generatePlanDraft, suggestStakeholders } from '../services/geminiService';
import { useProjectStructure } from './ProjectStructureContext';
import { useProjectPlan } from '../src/ui/hooks/useProjectPlan';
import { ProjectReportView } from './project/ProjectReportView';

interface ProjectManagerViewProps {
  activeTab: string;
}

const ProjectManagerView: React.FC<ProjectManagerViewProps> = ({ activeTab }) => {
  const { plan, setPlan, remoteSync } = useProjectStructure();

  const { isSaving } = useProjectPlan(remoteSync.projectId || '');

  const [viewMode, setViewMode] = useState<'edit' | 'report'>('edit');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [gateInfo, setGateInfo] = useState('');

  const handleUpdatePlan = <K extends keyof ProjectPlan>(key: K, value: ProjectPlan[K]) => {
    setPlan((prev) => ({ ...prev, [key]: value }));
  };

  const handleAIDraft = async (type: 'background' | 'description') => {
    try {
      const draft = await generatePlanDraft(type, `${plan.name}. ${plan.description}`.trim());
      handleUpdatePlan(type, draft);
      setGateInfo(`AI-utkast genererat för ${type}.`);
    } catch {
      setGateInfo(`Kunde inte generera AI-utkast.`);
    }
  };

  const handleGetStakeholders = async () => {
    setIsSuggesting(true);
    try {
      const suggestions = await suggestStakeholders(plan.location.address, plan.description);
      if (suggestions.length > 0) {
        handleUpdatePlan('stakeholders', suggestions);
        setGateInfo('Intressentlista uppdaterad.');
      }
    } catch {
      setGateInfo(`Kunde inte hämta intressentförslag.`);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleSignPhase = (phaseId: string) => {
    setPlan((prev) => ({
      ...prev,
      phases: prev.phases.map((p) => (p.id === phaseId ? { ...p, status: 'DONE', isLocked: true } : p)),
      auditTrail: [
        ...prev.auditTrail,
        {
          id: `A${Date.now()}`,
          timestamp: new Date().toISOString(),
          user: 'Projektledare',
          action: 'Fas Signerad',
          details: `Fas ${phaseId} godkänd och låst.`,
          immutable: true,
        },
      ],
    }));
  };

  if (viewMode === 'report') {
    return <ProjectReportView plan={plan} onClose={() => setViewMode('edit')} />;
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-10 pb-20">
      {activeTab === 'plan' && (
        <div className="max-w-5xl mx-auto space-y-8" data-testid="project-manager-plan">
          <div className="bg-white p-10 md:p-16 rounded-[3rem] border border-slate-200 shadow-sm space-y-12">
            <header className="flex justify-between items-end border-b border-slate-100 pb-10">
              <div className="space-y-4 flex-1">
                <input
                  className="text-4xl font-black text-slate-900 tracking-tighter italic bg-transparent border-none outline-none focus:ring-0 w-full"
                  value={plan.name}
                  onChange={(e) => handleUpdatePlan('name', e.target.value)}
                  placeholder="Projektnamn..."
                />
                <div className="flex items-center gap-4">
                  <input
                    className="text-xs font-bold text-slate-400 not-italic uppercase tracking-[0.2em] bg-transparent border-none outline-none focus:ring-0"
                    value={plan.revision}
                    onChange={(e) => handleUpdatePlan('revision', e.target.value)}
                    placeholder="Revision / Utgåva..."
                  />
                  {isSaving && (
                    <span className="text-[10px] font-bold text-blue-500 animate-pulse">Sparar...</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setViewMode('report')}
                className="px-6 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl flex items-center gap-2 hover:bg-blue-600 transition-all"
              >
                <i className="fas fa-file-pdf"></i> Sammanställ Styrdokument
              </button>
            </header>

            <section className="space-y-6">
              {gateInfo ? (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
                  {gateInfo}
                </div>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">
                      Bakgrund & Behov
                    </label>
                    <button
                      onClick={() => handleAIDraft('background')}
                      disabled={isSuggesting}
                      className="text-[9px] font-black text-blue-600 uppercase hover:underline"
                    >
                      {isSuggesting ? 'Skriver...' : 'Få AI-utkast'}
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
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">
                      Projektbeskrivning
                    </label>
                    <button
                      onClick={() => handleAIDraft('description')}
                      disabled={isSuggesting}
                      className="text-[9px] font-black text-blue-600 uppercase hover:underline"
                    >
                      {isSuggesting ? 'Skriver...' : 'Få AI-utkast'}
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

              <div className="pt-10 space-y-6">
                <h4 className="text-xl font-black text-slate-900 italic tracking-tight">
                  Ansvars-spärrar (Stop Gates)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {plan.phases.map((phase) => (
                    <div
                      key={phase.id}
                      className={`p-6 rounded-3xl border transition-all ${
                        phase.status === 'DONE'
                          ? 'bg-emerald-50 border-emerald-200'
                          : 'bg-white border-slate-100'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-4">
                        <span
                          className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${
                            phase.status === 'DONE'
                              ? 'bg-emerald-500 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {phase.status}
                        </span>
                      </div>
                      <h5 className="font-black text-slate-800 text-sm mb-2">{phase.title}</h5>
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-4">
                        {phase.tasks.length} Uppgifter
                      </p>

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
                  <h4 className="text-xl font-black text-slate-900 italic tracking-tight">
                    Intressentanalys
                  </h4>
                  <button
                    onClick={handleGetStakeholders}
                    disabled={isSuggesting}
                    className="px-6 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-600 hover:text-white transition-all shadow-sm"
                  >
                    {isSuggesting ? (
                      <i className="fas fa-spinner fa-spin"></i>
                    ) : (
                      <i className="fas fa-users-viewfinder"></i>
                    )}
                    {isSuggesting ? 'Analyserar...' : 'Föreslå Intressenter'}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {plan.stakeholders.map((s) => (
                    <div
                      key={s.id}
                      className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm hover:border-indigo-200 transition-all group"
                    >
                      <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">
                        {s.role}
                      </p>
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
    </div>
  );
};

export default ProjectManagerView;
