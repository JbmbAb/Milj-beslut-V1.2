import React, { useMemo, useState } from 'react';
import { AppContentRouter } from '../AppContentRouter';
import { uiConfig } from '@miljobeslut/mps-console';
import { AppSidebar } from '../AppSidebar';
import { AppHeader } from '../AppHeader';
import ChatBot from '../ChatBot';
import DetailModal from '../DetailModal';
import { TechnicalDashboardHub } from '../TechnicalDashboardHub';
import UploadModal from '../UploadModal';
import { useProjectStructure } from '../ProjectStructureContext';
import { countReadyModules } from '../../services/projectStructure';
import { MODE_CARDS } from './modeCards';
import { useAppSession } from './providers/AppSessionProvider';
import { useAppWorkspace } from './providers/AppWorkspaceProvider';
import { useTheme } from '../context/ThemeContext';
import { CommandPalette, InspectorPanel } from '../ui';
import { featureFlags } from '../../src/infrastructure/feature-flags';
import { setSession, callApi } from '../../services/coreApiClient';
import { MimerProductShell } from './MimerProductShell';

export const AppShell: React.FC = () => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { plan } = useProjectStructure();

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = window.localStorage.getItem('miljobeslut_admin_bearer');
      if (token === 'dummy-token') {
        window.localStorage.removeItem('miljobeslut_admin_bearer');
        window.localStorage.removeItem('miljobeslut_admin_refresh');
        window.localStorage.removeItem('miljobeslut_admin_project');
        window.location.reload();
      }
    }
  }, []);

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
  const requiredGateCount = useMemo(
    () => plan.stageGates.filter((gate) => gate.required).length,
    [plan],
  );
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
    const handleLogin = async () => {
      setIsLoggingIn(true);
      try {
        const payload = await callApi<{
          ok: boolean;
          accessToken: string;
          refreshToken: string;
          user: { id: string };
        }>('/api/admin/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'dev' },
          auth: false,
        });
        if (payload.ok) {
          setSession({
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken,
            activeProjectId: 'cmsfmguf30002zsf7pfdffk7b',
          });
          onLoginSuccess({
            id: payload.user.id,
            name: 'Admin Developer',
            personalNumber: '198001011234',
            isAuthenticated: true,
          });
        } else {
          setIsLoggingIn(false);
        }
      } catch (err) {
        console.error('Login failed', err);
        setIsLoggingIn(false);
      }
    };

    return (
      <div
        data-testid="app-login"
        className="min-h-screen flex items-center justify-center bg-slate-950 text-white"
      >
        <div className="text-center">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
            Logga in
          </p>
          {isLoggingIn ? (
            <div className="mt-6">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-white/10 border-t-indigo-500" />
              <p className="mt-2 text-xs text-slate-400">Loggar in via backenden...</p>
            </div>
          ) : (
            <button
              type="button"
              data-testid="dev-login"
              onClick={handleLogin}
              className="mt-4 p-3 bg-indigo-600 hover:bg-indigo-700 transition-colors font-bold text-sm px-6 rounded-xl shadow-lg"
            >
              Logga In Dummy
            </button>
          )}
        </div>
      </div>
    );
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

  // Default product UI — TechnicalDashboardHub only via VITE_ENABLE_LEGACY_UI=1
  if (!uiConfig.enableLegacyUi) {
    return (
      <MimerProductShell
        userName={sessionUser?.name || bootstrap?.user.displayName || 'Verifierad användare'}
        organisationName={bootstrap?.organisation.name}
        activeProjectLabel={activeProjectLabel}
      />
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

      <InspectorPanel />
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
