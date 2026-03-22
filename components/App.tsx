import React, { Suspense, lazy, useState } from 'react';
import type { InterfaceMode } from '../types';
import { resolveInterfaceModeFromModuleId } from './workspaceModes';
import { preloadWorkspaceForMode } from './workspacePreload';

const loadWorkspaceApp = () => import('./WorkspaceApp');
const TechnicalDashboardHub = lazy(() =>
  import('./TechnicalDashboardHub').then((module) => ({ default: module.TechnicalDashboardHub }))
);
const WorkspaceApp = lazy(loadWorkspaceApp);

const ContentFallback: React.FC<{ label?: string }> = ({ label = 'Laddar vy' }) => (
  <div className="flex h-screen items-center justify-center bg-slate-50">
    <div className="rounded-[28px] border border-slate-200 bg-white/90 px-8 py-10 text-center shadow-sm">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-900" />
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
    </div>
  </div>
);

const App: React.FC = () => {
  const [mode, setMode] = useState<InterfaceMode | null>(null);

  const preloadModuleWorkspace = (moduleId: string) => {
    const nextMode = resolveInterfaceModeFromModuleId(moduleId);
    if (!nextMode) return;

    void loadWorkspaceApp().then(() => preloadWorkspaceForMode(nextMode));
  };

  if (!mode) {
    return (
      <Suspense fallback={<ContentFallback label="Laddar dashboard" />}>
        <TechnicalDashboardHub
          onSelectModule={(id) => {
            const nextMode = resolveInterfaceModeFromModuleId(id);
            if (nextMode) setMode(nextMode);
          }}
          onPreviewModule={preloadModuleWorkspace}
          user={{ name: 'System User' }}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<ContentFallback label="Laddar arbetsyta" />}>
      <WorkspaceApp initialMode={mode} onExitToDashboard={() => setMode(null)} />
    </Suspense>
  );
};

export default App;
