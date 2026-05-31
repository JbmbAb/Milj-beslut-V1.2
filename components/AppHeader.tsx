import React from 'react';

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
  return (
    <header className="h-20 border-b border-white/5 flex items-center justify-between px-10 shrink-0 bg-slate-950/50 backdrop-blur-xl z-10 shadow-2xl">
      <div className="flex items-center gap-6">
        <h2
          data-testid="workspace-active-tab-label"
          className="text-[11px] font-black uppercase tracking-[0.2em] text-white flex items-center gap-3"
        >
          <span
            className={`w-2.5 h-2.5 rounded-full ${activeMode.accent} shadow-[0_0_12px_rgba(var(--accent-rgb),0.5)]`}
          />
          {activeTab}
        </h2>
        <div className="h-6 w-px bg-white/10 hidden md:block" />
        <p className="hidden md:block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          {activeMode.title}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden lg:flex items-center gap-2 mr-4">
          <div className="flex -space-x-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="w-6 h-6 rounded-full bg-slate-800 border-2 border-slate-950 flex items-center justify-center"
              >
                <i className="fas fa-user text-[10px] text-slate-500" />
              </div>
            ))}
          </div>
          <span className="text-[10px] font-bold text-slate-400 ml-1">3 AKTIVA</span>
        </div>

        <div className="flex items-center gap-2 bg-white/5 p-1 rounded-2xl border border-white/10">
          <span className="text-[9px] font-black px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            {readyModuleCount}/{totalModuleCount} REDO
          </span>
          <span className="text-[9px] font-black px-3 py-1.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
            GATES {passedGateCount}/{requiredGateCount}
          </span>
          <span className="text-[9px] font-black px-3 py-1.5 rounded-xl bg-slate-800 text-slate-400 border border-white/5">
            {activeProjectLabel || 'INGET PROJEKT'}
          </span>
        </div>
      </div>
    </header>
  );
};
