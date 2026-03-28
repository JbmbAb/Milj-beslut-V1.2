import React, { Suspense, lazy, useState } from 'react';
import { AlertTriangle, FileText, LayoutDashboard, Rocket, Search } from 'lucide-react';
import type { Project } from './mvp/mvpDemoModel';

const ProjectDashboardView = lazy(() => import('./mvp/MvpProjectDashboardView'));
const DocumentSearchView = lazy(() => import('./mvp/MvpDocumentSearchView'));
const ClassificationPanelView = lazy(() => import('./mvp/MvpClassificationPanelView'));
const PermitGeneratorView = lazy(() => import('./mvp/MvpPermitGeneratorView'));
const MunicipalityInsightPanel = lazy(() => import('./mvp/MvpMunicipalityInsightPanel'));

type ViewId = 'dashboard' | 'search' | 'classify' | 'generate';

const ViewFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-slate-200 bg-white/70 p-10 shadow-sm">
    <div className="text-center">
      <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
    </div>
  </div>
);

const InsightFallback: React.FC = () => (
  <div className="space-y-6">
    <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
    <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />
    <div className="h-40 animate-pulse rounded-3xl bg-slate-100" />
  </div>
);

export const MvpDemoInterface: React.FC = () => {
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [view, setView] = useState<ViewId>('dashboard');

  const navItems: Array<{
    id: ViewId;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
    disabled: boolean;
  }> = [
    { id: 'dashboard', label: 'Projekt', icon: LayoutDashboard, disabled: false },
    { id: 'search', label: 'Sök kunskap', icon: Search, disabled: !activeProject },
    { id: 'classify', label: 'AI Klassificering', icon: Rocket, disabled: !activeProject },
    { id: 'generate', label: 'C-anmälan', icon: FileText, disabled: !activeProject },
  ];

  const handleProjectSelect = (project: Project) => {
    setActiveProject(project);
    setView('search');
  };

  return (
    <div className="flex h-full flex-col bg-slate-50 font-['Plus_Jakarta_Sans']">
      <nav className="sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-8 py-4">
        <div className="flex items-center gap-2">
          {activeProject ? (
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
                <LayoutDashboard size={18} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest leading-none text-slate-400">
                  Aktivt Projekt
                </p>
                <p className="text-sm font-black leading-tight text-slate-900">
                  {activeProject.propertyDesignation}
                </p>
              </div>
            </div>
          ) : (
            <h1 className="text-lg font-black tracking-tight text-slate-900">
              Miljöbeslut.se <span className="text-indigo-600">MVP</span>
            </h1>
          )}
        </div>

        <div className="flex gap-1 rounded-2xl bg-slate-100 p-1.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              disabled={item.disabled}
              onClick={() => setView(item.id)}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black transition-all ${
                view === item.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : item.disabled
                    ? 'cursor-not-allowed text-slate-300'
                    : 'text-slate-500 hover:bg-slate-200/50 hover:text-slate-700'
              }`}
            >
              <item.icon size={16} /> {item.label}
            </button>
          ))}
          {activeProject ? (
            <button
              onClick={() => {
                setActiveProject(null);
                setView('dashboard');
              }}
              className="px-3 py-2.5 text-slate-400 transition-colors hover:text-red-500"
              title="Avbryt projekt"
            >
              <AlertTriangle size={16} />
            </button>
          ) : null}
        </div>
      </nav>

      <main className="w-full flex-1 overflow-y-auto px-8 py-8">
        <div
          className={`mx-auto grid max-w-7xl gap-8 ${
            activeProject ? 'lg:grid-cols-[1fr_320px]' : 'grid-cols-1'
          }`}
        >
          <div className="space-y-8">
            {view === 'dashboard' ? (
              <Suspense fallback={<ViewFallback label="Laddar projektvy" />}>
                <ProjectDashboardView onSelect={handleProjectSelect} />
              </Suspense>
            ) : null}
            {view === 'search' && activeProject ? (
              <Suspense fallback={<ViewFallback label="Laddar kunskapsvy" />}>
                <DocumentSearchView project={activeProject} />
              </Suspense>
            ) : null}
            {view === 'classify' && activeProject ? (
              <Suspense fallback={<ViewFallback label="Laddar klassificering" />}>
                <ClassificationPanelView project={activeProject} />
              </Suspense>
            ) : null}
            {view === 'generate' && activeProject ? (
              <Suspense fallback={<ViewFallback label="Laddar anmalningsvy" />}>
                <PermitGeneratorView project={activeProject} />
              </Suspense>
            ) : null}
          </div>

          {activeProject ? (
            <Suspense fallback={<InsightFallback />}>
              <MunicipalityInsightPanel project={activeProject} />
            </Suspense>
          ) : null}
        </div>
      </main>
    </div>
  );
};

export default MvpDemoInterface;
