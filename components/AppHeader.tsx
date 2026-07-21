import React from 'react';
import { useOperationsCenter, type WorkflowStepId } from './context/OperationsCenterContext';

interface AppHeaderProps {
  activeTab: string;
  activeMode: {
    accent: string;
    title: string;
  };
  readyModuleCount: number;
  totalModuleCount: number;
  blockedModuleCount: number;
  passedGateCount: number;
  requiredGateCount: number;
  carbonReady: boolean;
  activeProjectLabel: string | null;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeTab,
  activeMode,
  readyModuleCount,
  totalModuleCount,
  blockedModuleCount: _blockedModuleCount,
  passedGateCount,
  requiredGateCount,
  carbonReady: _carbonReady,
  activeProjectLabel,
}) => {
  const { activeStep, setActiveStep, workflowSteps, setCommandPaletteOpen } = useOperationsCenter();

  return (
    <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 shrink-0 bg-slate-900 z-10 shadow-lg text-slate-100 transition-colors duration-150">
      {/* Tab and Mode Metadata */}
      <div className="flex items-center gap-4">
        <div className="flex flex-col">
          <h2
            data-testid="workspace-active-tab-label"
            className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2"
          >
            <span
              className={`w-2 h-2 rounded-full ${activeMode.accent === 'bg-indigo-500' ? 'bg-cyan-500' : activeMode.accent}`}
            />
            {activeTab}
          </h2>
          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">
            {activeMode.title}
          </span>
        </div>
      </div>

      {/* Workflow Step Timeline */}
      <div className="hidden xl:flex items-center gap-1.5 bg-slate-950/40 border border-slate-800 rounded-xl p-1">
        {workflowSteps.map((step) => {
          const isActive = step.id === activeStep;
          const isPassed = step.id < activeStep;

          return (
            <div key={step.id} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveStep(step.id as WorkflowStepId)}
                className={`px-3 py-1 rounded-lg text-[10px] font-black tracking-wide flex items-center gap-1.5 transition-all ${
                  isActive
                    ? 'bg-cyan-950 text-cyan-400 border border-cyan-800/40'
                    : isPassed
                      ? 'text-emerald-400 hover:text-slate-100'
                      : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] ${
                  isActive
                    ? 'bg-cyan-500 text-cyan-950'
                    : isPassed
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-500'
                }`}>
                  {isPassed ? <i className="fas fa-check" /> : step.id}
                </div>
                <span>{step.label}</span>
              </button>
              {step.id !== 5 && <i className="fas fa-angle-right text-[9px] text-slate-700" />}
            </div>
          );
        })}
      </div>

      {/* Search Input Box & Metrics */}
      <div className="flex items-center gap-4">
        {/* Interactive Command Center Trigger */}
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-950/60 border border-slate-800 hover:border-slate-700 rounded-xl text-left text-[11px] text-slate-500 transition-all w-48 md:w-56"
        >
          <i className="fas fa-search text-xs" />
          <span className="flex-1 truncate">Sök verktyg eller lager...</span>
          <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-400 text-[8px] rounded border border-slate-700">Ctrl+K</kbd>
        </button>

        {/* User Stats and Status Indicator */}
        <div className="flex items-center gap-2 bg-slate-950/60 px-2 py-1 rounded-xl border border-slate-800">
          <span className="text-[9px] font-black px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {readyModuleCount}/{totalModuleCount} REDO
          </span>
          <span className="text-[9px] font-black px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            GATES {passedGateCount}/{requiredGateCount}
          </span>
          <span className="text-[9px] font-black px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 border border-slate-700/60 uppercase max-w-[120px] truncate" title={activeProjectLabel || 'INGET PROJEKT'}>
            {activeProjectLabel || 'INGET PROJEKT'}
          </span>
        </div>
      </div>
    </header>
  );
};

