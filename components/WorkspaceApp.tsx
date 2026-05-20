import React, { Suspense, lazy, useMemo, useState } from 'react';
import type { InterfaceMode } from '../types';
import { MODE_CARDS } from './workspaceModes';
import { loadProjectWorkspace, loadStandaloneWorkspace, needsProjectStructure } from './workspacePreload';

const ProjectWorkspace = lazy(loadProjectWorkspace);
const StandaloneWorkspace = lazy(loadStandaloneWorkspace);

type WorkspaceAppProps = {
  initialMode: InterfaceMode;
  onExitToDashboard: () => void;
};

const WorkspaceFallback: React.FC<{ label?: string }> = ({ label = 'Laddar arbetsyta' }) => (
  <div className="flex h-screen items-center justify-center bg-slate-50">
    <div className="rounded-[28px] border border-slate-200 bg-white/90 px-8 py-10 text-center shadow-sm">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-900" />
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
    </div>
  </div>
);

const WorkspaceApp: React.FC<WorkspaceAppProps> = ({ initialMode, onExitToDashboard }) => {
  const [mode, setMode] = useState<InterfaceMode>(initialMode);
  const [activeTab, setActiveTab] = useState(() => {
    const initialConfig = MODE_CARDS.find((item) => item.mode === initialMode);
    return initialConfig?.defaultTab || 'summary';
  });

  const modeCardMap = useMemo(() => {
    return MODE_CARDS.reduce<Record<InterfaceMode, (typeof MODE_CARDS)[number]>>(
      (acc, item) => {
        acc[item.mode] = item;
        return acc;
      },
      {} as Record<InterfaceMode, (typeof MODE_CARDS)[number]>,
    );
  }, []);

  const openMode = (nextMode: InterfaceMode) => {
    setMode(nextMode);
    setActiveTab(modeCardMap[nextMode].defaultTab);
  };

  const projectAware = needsProjectStructure(mode, activeTab);

  return (
    <Suspense
      fallback={<WorkspaceFallback label={projectAware ? 'Laddar projektvy' : 'Laddar fristaende vy'} />}
    >
      {projectAware ? (
        <ProjectWorkspace
          mode={mode}
          activeTab={activeTab}
          onSetActiveTab={setActiveTab}
          onOpenMode={openMode}
          onExitToDashboard={onExitToDashboard}
        />
      ) : (
        <StandaloneWorkspace
          mode={mode}
          activeTab={activeTab}
          onSetActiveTab={setActiveTab}
          onOpenMode={openMode}
          onExitToDashboard={onExitToDashboard}
        />
      )}
    </Suspense>
  );
};

export default WorkspaceApp;
