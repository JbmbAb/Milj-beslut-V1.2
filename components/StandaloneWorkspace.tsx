import React, { Suspense, lazy } from 'react';
import type { InterfaceMode } from '../types';
import WorkspaceScaffold from './WorkspaceScaffold';
import RequirementChecklist from './RequirementChecklist';
const ChatBot = lazy(() => import('./ChatBot'));
const FieldAssistant = lazy(() => import('./FieldAssistant'));
const CoreWorkflowView = lazy(() => import('./CoreWorkflowView'));
const AdminMetadataReview = lazy(() => import('./AdminMetadataReview'));
const AdminSearchConsole = lazy(() => import('./AdminSearchConsole'));

type StandaloneWorkspaceProps = {
  mode: InterfaceMode;
  activeTab: string;
  onSetActiveTab: (tab: string) => void;
  onOpenMode: (mode: InterfaceMode) => void;
  onExitToDashboard: () => void;
};

const ContentFallback: React.FC<{ label?: string }> = ({ label = 'Laddar vy' }) => (
  <div className="flex h-full min-h-[320px] items-center justify-center">
    <div className="rounded-[28px] border border-slate-200 bg-white/90 px-8 py-10 text-center shadow-sm">
      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-900" />
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
    </div>
  </div>
);

const StandaloneWorkspace: React.FC<StandaloneWorkspaceProps> = ({
  mode,
  activeTab,
  onSetActiveTab,
  onOpenMode,
  onExitToDashboard,
}) => {
  const renderContent = () => {
    if (activeTab === 'requirements') return <RequirementChecklist code={{ code: "dummy", name: "dummy" } as any} />;

    switch (mode) {
      case 'Core_WORKFLOW':
        return <CoreWorkflowView />;
      case 'ADMIN_CONSOLE':
        if (activeTab === 'admin-review') return <AdminMetadataReview />;
        if (activeTab === 'admin-search') return <AdminSearchConsole panel="search" />;
        if (activeTab === 'admin-insight') return <AdminSearchConsole panel="insight" />;
        return <AdminMetadataReview />;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <i className="fas fa-layer-group text-4xl mb-4 opacity-20" />
            <p className="text-sm font-bold uppercase tracking-widest">Valj en sektion i menyn</p>
          </div>
        );
    }
  };

  const headerBadges =
    mode === 'ADMIN_CONSOLE' ? (
      <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
        ADMIN SESSION
      </span>
    ) : (
      <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
        WORKFLOW READY
      </span>
    );

  return (
    <WorkspaceScaffold
      mode={mode}
      activeTab={activeTab}
      onSetActiveTab={onSetActiveTab}
      onOpenMode={onOpenMode}
      onExitToDashboard={onExitToDashboard}
      headerBadges={headerBadges}
    >
      <Suspense fallback={<ContentFallback label={`Laddar ${activeTab}`} />}>{renderContent()}</Suspense>
      <Suspense fallback={null}>
        <ChatBot onOpenLegalSupport={() => onSetActiveTab('legal')} />
      </Suspense>
    </WorkspaceScaffold>
  );
};

export default StandaloneWorkspace;
