import React, { Suspense, lazy, useMemo, useState } from 'react';
import type { InterfaceMode, Permit } from '../types';
import { ProjectStructureProvider, useProjectStructure } from './ProjectStructureContext';
import { countReadyModules } from '../services/projectStructure';
import WorkspaceScaffold from './WorkspaceScaffold';
import AdminSearchConsole from './AdminSearchConsole';
import RequirementChecklist from './RequirementChecklist';



const ExecutiveSummary = lazy(() => import('./ExecutiveSummary'));
const DetailModal = lazy(() => import('./DetailModal'));
const ChatBot = lazy(() => import('./ChatBot'));
const IntegrationsDashboard = lazy(() => import('./IntegrationsDashboard'));
const ApplicationWizard = lazy(() => import('./ApplicationWizard'));
const AssetTriage = lazy(() => import('./AssetTriage'));
const FieldAssistant = lazy(() => import('./FieldAssistant'));
const GisRiskModule = lazy(() => import('./GisRiskModule'));
const CNotificationMassUI = lazy(() =>
  import('./admin/modules/c-notification-mass/CNotificationMassUI').then((module) => ({
    default: module.CNotificationMassUI,
  })),
);

const FormManager = lazy(() => import('./FormManager'));
const SluExpert = lazy(() => import('./SluExpert'));

type ProjectWorkspaceProps = {
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

const ProjectWorkspaceInner: React.FC<ProjectWorkspaceProps> = ({
  mode,
  activeTab,
  onSetActiveTab,
  onOpenMode,
  onExitToDashboard,
}) => {
  const { plan } = useProjectStructure();
  const permits: Permit[] = [];
  const [selectedPermit, setSelectedPermit] = useState<Permit | null>(null);

  const readyModuleCount = useMemo(() => countReadyModules(plan), [plan]);
  const blockedModuleCount = useMemo(
    () => plan.moduleIntegrations.filter((item) => item.readiness === 'BLOCKED').length,
    [plan],
  );
  const requiredGateCount = useMemo(() => plan.stageGates.filter((gate) => gate.required).length, [plan]);
  const passedGateCount = useMemo(
    () => plan.stageGates.filter((gate) => gate.required && gate.status === 'PASSED').length,
    [plan],
  );
  const carbonReady = Boolean(plan.carbonSummary.lastResult);
  const normalizedMode = mode === 'PERMIT_PORTAL' ? 'Core_WORKFLOW' : mode;
  const normalizedTab =
    mode === 'PERMIT_PORTAL'
      ? activeTab === 'apply'
        ? 'c-notification-mass'
        : activeTab === 'map' ||
            activeTab === 'forms' ||
            activeTab === 'biodiversity' ||
            activeTab === 'risks'
          ? 'core'
          : activeTab
      : activeTab;

  const renderContent = () => {
    if (normalizedTab === 'requirements') return <RequirementChecklist code={{ code: "dummy", name: "dummy" } as any} />;

    switch (normalizedMode) {
      case 'LOGISTICS_MARKET':
        if (normalizedTab === 'archive') return <ExecutiveSummary />;
        if (normalizedTab === 'triage') return <AssetTriage />;
        return <ExecutiveSummary />;
      case 'Core_WORKFLOW':
        if (normalizedTab === 'c-notification-mass') return <CNotificationMassUI />;
        if (normalizedTab === 'score') return <GisRiskModule />;
        return <CNotificationMassUI />;
      case 'PROJECT_MANAGER':
        if (normalizedTab === 'plan') return <ApplicationWizard />;
        if (normalizedTab === 'field') return <FieldAssistant />;
        return <ApplicationWizard />;
      case 'COMPLIANCE_AUDIT':
        if (normalizedTab === 'score') return <GisRiskModule />;
        return <IntegrationsDashboard />;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <i className="fas fa-layer-group text-4xl mb-4 opacity-20" />
            <p className="text-sm font-bold uppercase tracking-widest">Valj en sektion i menyn</p>
          </div>
        );
    }
  };

  const headerBadges = (
    <>
      <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
        MODULER REDO {readyModuleCount}/{plan.moduleIntegrations.length}
      </span>
      <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        BLOCKER {blockedModuleCount}
      </span>
      <span className="text-[10px] font-black px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
        GATES {passedGateCount}/{requiredGateCount}
      </span>
      <span
        className={`text-[10px] font-black px-3 py-1.5 rounded-full border ${
          carbonReady
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-slate-100 text-slate-500 border-slate-200'
        }`}
      >
        CO2 {carbonReady ? 'REDO' : 'SAKNAS'}
      </span>
    </>
  );

  return (
    <>
      <WorkspaceScaffold
        mode={mode}
        activeTab={activeTab}
        onSetActiveTab={onSetActiveTab}
        onOpenMode={onOpenMode}
        onExitToDashboard={onExitToDashboard}
        headerBadges={headerBadges}
      >
        <Suspense fallback={<ContentFallback label={`Laddar ${activeTab}`} />}>{renderContent()}</Suspense>
        {/* ProjectWorkspace is legacy/parked (excluded from the live app's build entry point --
            see PRODUCT-RUNTIME-ANSWER-BYPASS-01/-CONVERGENCE-01's trace); onOpenLegalSupport is a
            no-op here rather than wired to real navigation this component doesn't have. */}
        <Suspense fallback={null}>
          <ChatBot onOpenLegalSupport={() => {}} />
        </Suspense>
      </WorkspaceScaffold>

      {selectedPermit && (
        <Suspense fallback={null}>
          <DetailModal
            permit={selectedPermit}
            onClose={() => setSelectedPermit(null)}
            onOpenLegalSupport={() => setSelectedPermit(null)}
          />
        </Suspense>
      )}
    </>
  );
};

const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = (props) => (
  <ProjectStructureProvider>
    <ProjectWorkspaceInner {...props} />
  </ProjectStructureProvider>
);

export default ProjectWorkspace;
