import React, { useMemo } from 'react';
import { AppContentRouter } from '../AppContentRouter';
import { AppSidebar } from '../AppSidebar';
import { AppHeader } from '../AppHeader';
import BankIDLogin from '../BankIDLogin';
import ChatBot from '../ChatBot';
import DetailModal from '../DetailModal';
import { TechnicalDashboardHub } from '../TechnicalDashboardHub';
import UploadModal from '../UploadModal';
import { useProjectStructure } from '../ProjectStructureContext';
import { countReadyModules } from '../../services/projectStructure';
import { MODE_CARDS } from './modeCards';
import { useAppSession } from './providers/AppSessionProvider';
import { useAppWorkspace } from './providers/AppWorkspaceProvider';
import { useOperationsCenter } from '../context/OperationsCenterContext';
import { useTheme } from '../context/ThemeContext';
import { CommandPalette, InspectorPanel } from '../ui';
import { featureFlags } from '../../src/infrastructure/feature-flags';


export const AppShell: React.FC = () => {
  const { plan } = useProjectStructure();
  const {
    sessionState,
    sessionError,
    bootstrap,
    sessionUser,
    retryBootstrap,
    onLoginSuccess,
    clearSessionAndReset,
  } = useAppSession();
  const { isDark } = useTheme();

  const {
    mode,
    activeTab,
    setActiveTab,
    setMode,
    openMode,
    permits,
    selectedPermit,
    setSelectedPermit,
    showUpload,
    setShowUpload,
    activeMode,
    activeProjectLabel,
  } = useAppWorkspace();

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

  const filteredModeCards = useMemo(() => {
    return MODE_CARDS.filter((card) => !card.flag || featureFlags.isEnabled(card.flag));
  }, []);

  if (sessionState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-indigo-500" />
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
            Laddar verifierad session
          </p>
        </div>
      </div>
    );
  }

  if (sessionState === 'unauthenticated') {
    return <BankIDLogin onLogin={onLoginSuccess} />;
  }

  if (sessionState === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="w-full max-w-lg rounded-[2rem] border border-rose-400/20 bg-white/5 p-8 text-white">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-rose-300">
            Session kunde inte verifieras
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight">Startflodet ar inte redo</h1>
          <p className="mt-4 text-sm text-slate-300">{sessionError || 'Okant fel vid bootstrap.'}</p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => {
                void retryBootstrap();
              }}
              className="rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-900"
            >
              Forsok igen
            </button>
            <button
              type="button"
              onClick={clearSessionAndReset}
              className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black text-slate-200"
            >
              Logga in pa nytt
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!mode) {
    return (
      <TechnicalDashboardHub
        onSelectModule={(id) => {
          if (id === 'dossier') {
            setMode('Core_WORKFLOW');
            setActiveTab('dossier');
            return;
          }
          if (id === 'core' || id === 'ansokan') {
            openMode('Core_WORKFLOW');
            setActiveTab(id === 'ansokan' ? 'c-notification-mass' : 'core');
            return;
          }
          if (id === 'logistik') openMode('LOGISTICS_MARKET');
          else if (id === 'projekt') openMode('PROJECT_MANAGER');
          else if (id === 'gronkoll') openMode('COMPLIANCE_AUDIT');
          else if (id === 'admin') openMode('ADMIN_CONSOLE');
        }}
        user={{ name: sessionUser?.name || bootstrap?.user.displayName || 'Verifierad anvandare' }}
        organisationName={bootstrap?.organisation.name}
        activeProjectLabel={activeProjectLabel}
        moduleAccess={bootstrap?.moduleAccess}
        projectCount={bootstrap?.projects.length || 0}
        integrationStatus={bootstrap?.integrationAvailability.app.reason}
      />
    );
  }

  if (!activeMode) {
    return null;
  }

  return (
    <div
      data-testid="app-workspace-shell"
      className={`min-h-screen flex overflow-hidden font-['Plus_Jakarta_Sans'] transition-colors duration-150 ${
        isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* 1. Navigator (Left Sidebar - Width 72px collapsed, 256px expanded) */}
      <AppSidebar
        mode={mode}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        setMode={setMode}
        bootstrap={bootstrap}
        activeMode={activeMode}
        modeCards={filteredModeCards}
        openMode={openMode}
        setShowUpload={setShowUpload}
      />

      {/* 2. Workspace (Middle Main Pane - Flex Center Split) */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden border-r border-slate-850">
        <AppHeader
          activeTab={activeTab}
          activeMode={activeMode}
          readyModuleCount={readyModuleCount}
          totalModuleCount={plan.moduleIntegrations.length}
          blockedModuleCount={blockedModuleCount}
          passedGateCount={passedGateCount}
          requiredGateCount={requiredGateCount}
          carbonReady={carbonReady}
          activeProjectLabel={activeProjectLabel}
        />

        <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar relative">
          <AppContentRouter
            mode={mode}
            activeTab={activeTab}
            permits={permits}
            setSelectedPermit={setSelectedPermit}
            setActiveTab={setActiveTab}
            onOpenMassModule={() => {
              setMode('Core_WORKFLOW');
              setActiveTab('c-notification-mass');
            }}
          />
        </div>
        <ChatBot />
      </main>

      {/* 3. Inspector (Right Panel - Width 320px) */}
      <InspectorPanel />

      {/* 4. Global Command Palette (Ctrl+K overlay) */}
      <CommandPalette />

      {selectedPermit && <DetailModal permit={selectedPermit} onClose={() => setSelectedPermit(null)} />}
      {showUpload && (
        <UploadModal
          onComplete={(partial) => {
            setShowUpload(false);
            if (partial) setActiveTab('apply');
          }}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  );
};
