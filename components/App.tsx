import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { AppBootstrapResponse, InterfaceMode, Permit, User } from '../types';
import MarketIntelView from './MarketIntelView';
import PermitPortalView from './PermitPortalView';
import ExecutiveSummary from './ExecutiveSummary';
import DetailModal from './DetailModal';
import ChatBot from './ChatBot';
import FormManager from './FormManager';
import SluExpert from './SluExpert';
import IntegrationsDashboard from './IntegrationsDashboard';
import AssetTriage from './AssetTriage';
import FieldAssistant from './FieldAssistant';
import Guide from './Guide';
import GisRiskModule from './GisRiskModule';
import LegalSupportCenter from './LegalSupportCenter';
import CoreWorkflowView from './CoreWorkflowView';
import AdminMetadataReview from './AdminMetadataReview';
import AdminSearchConsole from './AdminSearchConsole';
import AdminGdprPanel from './AdminGdprPanel';
import AdminDbStatusPanel from './AdminDbStatusPanel';
import { useProjectStructure } from './ProjectStructureContext';
import { countReadyModules } from '../services/projectStructure';
import { TechnicalDashboardHub } from './TechnicalDashboardHub';
import SystemFunctionalAnalysis from './SystemFunctionalAnalysis';
import AppReadinessPanel from './AppReadinessPanel';
import MarketingHub from './MarketingHub';
import UploadModal from './UploadModal';
import ProjectManagerView from './ProjectManagerView';
import { AppContentRouter } from './AppContentRouter';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import BankIDLogin from './BankIDLogin';
import {
  callApi,
  clearSession,
  getActiveProjectId,
  getToken,
  refreshAccessSession,
  setActiveProjectId,
} from '../services/coreApiClient';

type ModeCardConfig = {
  mode: InterfaceMode;
  title: string;
  description: string;
  icon: string;
  accent: string;
  defaultTab: string;
};

const MODE_CARDS: ModeCardConfig[] = [
  {
    mode: 'LOGISTICS_MARKET',
    title: 'Logistik schaktmassor',
    description: 'Planera mottagning, transport och regelefterlevnad för masshantering.',
    icon: 'fa-chart-mixed',
    accent: 'bg-indigo-600',
    defaultTab: 'archive',
  },
  {
    mode: 'PERMIT_PORTAL',
    title: 'Provningsportal',
    description: 'Sök tillstånd, bygg ansökan och validera regelkrav.',
    icon: 'fa-file-shield',
    accent: 'bg-emerald-600',
    defaultTab: 'risks',
  },
  {
    mode: 'PROJECT_MANAGER',
    title: 'Projektplansportfölj',
    description: 'Gantt, riskanalys, intressenter, ansvar och grindar for huvudmodulerna.',
    icon: 'fa-list-check',
    accent: 'bg-amber-600',
    defaultTab: 'plan',
  },
  {
    mode: 'COMPLIANCE_AUDIT',
    title: 'Egenkontroll och revision',
    description: 'Bedömning av regelefterlevnad, revisionslogg och automatiserad rapportering.',
    icon: 'fa-shield-check',
    accent: 'bg-slate-700',
    defaultTab: 'score',
  },
  {
    mode: 'ADMIN_CONSOLE',
    title: 'Administrator',
    description: 'Separat adminyta med utökad sökning och analys.',
    icon: 'fa-user-shield',
    accent: 'bg-rose-600',
    defaultTab: 'admin-search',
  },
  {
    mode: 'Core_WORKFLOW',
    title: 'Huvudmoduler',
    description: 'Enskilt avlopp, C-anmalan och lokaliseringsutredning.',
    icon: 'fa-folder-open',
    accent: 'bg-indigo-600',
    defaultTab: 'core',
  },
];

function shouldForceReauthentication(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('http 401') ||
    message.includes('http 403') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('session expired') ||
    message.includes('token')
  );
}

const App: React.FC = () => {
  const { plan } = useProjectStructure();
  const hasAutoOpenedWorkspaceRef = useRef(false);
  const [sessionState, setSessionState] = useState<'loading' | 'unauthenticated' | 'ready' | 'error'>(() =>
    getToken() ? 'loading' : 'unauthenticated',
  );
  const [bootstrap, setBootstrap] = useState<AppBootstrapResponse | null>(null);
  const [sessionUser, setSessionUser] = useState<User | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [permits, setPermits] = useState<Permit[]>([]);
  const [selectedPermit, setSelectedPermit] = useState<Permit | null>(null);
  const [mode, setMode] = useState<InterfaceMode | null>(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [showUpload, setShowUpload] = useState(false);

  const requestBootstrap = useCallback(async () => {
    const preferredProjectId = getActiveProjectId();
    const payload = await callApi<{ ok: boolean; bootstrap: AppBootstrapResponse }>('/api/app/bootstrap', {
      method: 'GET',
      query: preferredProjectId ? { activeProjectId: preferredProjectId } : undefined,
    });
    return payload.bootstrap;
  }, []);

  const loadBootstrap = useCallback(
    async (allowRefresh = true) => {
      try {
        const nextBootstrap = await requestBootstrap();
        setBootstrap(nextBootstrap);
        setSessionUser({
          id: nextBootstrap.user.id,
          name: nextBootstrap.user.displayName,
          personalNumber: nextBootstrap.user.bankidId,
          isAuthenticated: true,
        });
        setSessionState('ready');
        setSessionError('');
        setActiveProjectId(nextBootstrap.activeProjectId);
      } catch (error: unknown) {
        let resolvedError: unknown = error;
        if (allowRefresh && getToken()) {
          try {
            await refreshAccessSession();
            const nextBootstrap = await requestBootstrap();
            setBootstrap(nextBootstrap);
            setSessionUser({
              id: nextBootstrap.user.id,
              name: nextBootstrap.user.displayName,
              personalNumber: nextBootstrap.user.bankidId,
              isAuthenticated: true,
            });
            setSessionState('ready');
            setSessionError('');
            setActiveProjectId(nextBootstrap.activeProjectId);
            return;
          } catch (refreshError: unknown) {
            resolvedError = refreshError;
            if (shouldForceReauthentication(refreshError)) {
              clearSession();
            }
          }
        } else if (shouldForceReauthentication(error)) {
          clearSession();
        }

        const stillHasSession = Boolean(getToken());

        hasAutoOpenedWorkspaceRef.current = false;
        setBootstrap(null);
        setPermits([]);
        setMode(null);
        setSessionUser(null);
        setSessionState(stillHasSession ? 'error' : 'unauthenticated');
        setSessionError(
          resolvedError instanceof Error ? resolvedError.message : 'Kunde inte ladda appstart.',
        );
      }
    },
    [requestBootstrap],
  );

  useEffect(() => {
    if (!getToken()) return;
    const timer = window.setTimeout(() => {
      void loadBootstrap();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadBootstrap]);

  useEffect(() => {
    if (sessionState !== 'ready') return;
    if (!bootstrap?.activeProjectId) return;
    if (mode !== null) return;
    if (hasAutoOpenedWorkspaceRef.current) return;

    const timer = window.setTimeout(() => {
      hasAutoOpenedWorkspaceRef.current = true;
      setMode('PERMIT_PORTAL');
      setActiveTab('risks');
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [bootstrap?.activeProjectId, mode, sessionState]);

  useEffect(() => {
    if (sessionState !== 'ready') return;
    void callApi<{ ok: boolean; permits?: Permit[] }>('/api/permits', { method: 'GET' })
      .then((data) => {
        if (data.ok && data.permits) setPermits(data.permits);
      })
      .catch(() => {
        setPermits([]);
      });
  }, [sessionState]);

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

  const modeCardMap = useMemo(() => {
    return MODE_CARDS.reduce<Record<InterfaceMode, ModeCardConfig>>(
      (acc, item) => {
        acc[item.mode] = item;
        return acc;
      },
      {} as Record<InterfaceMode, ModeCardConfig>,
    );
  }, []);

  const activeProject = useMemo(
    () => bootstrap?.projects.find((project) => project.id === bootstrap.activeProjectId) || null,
    [bootstrap],
  );

  const openMode = (nextMode: InterfaceMode) => {
    setMode(nextMode);
    setActiveTab(modeCardMap[nextMode].defaultTab);
  };

  const renderContent = () => (
    <AppContentRouter
      mode={mode}
      activeTab={activeTab}
      permits={permits}
      setSelectedPermit={setSelectedPermit}
      setActiveTab={setActiveTab}
    />
  );

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
    return (
      <BankIDLogin
        onLogin={(user) => {
          setSessionUser(user);
          setSessionState('loading');
          void loadBootstrap();
        }}
      />
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
                setSessionState('loading');
                void loadBootstrap();
              }}
              className="rounded-xl bg-white px-4 py-3 text-sm font-black text-slate-900"
            >
              Forsok igen
            </button>
            <button
              type="button"
              onClick={() => {
                clearSession();
                setSessionError('');
                setSessionState('unauthenticated');
              }}
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
          if (id === 'core') openMode('Core_WORKFLOW');
          else if (id === 'ansokan') openMode('PERMIT_PORTAL');
          else if (id === 'logistik') openMode('LOGISTICS_MARKET');
          else if (id === 'projekt') openMode('PROJECT_MANAGER');
          else if (id === 'gronkoll') openMode('COMPLIANCE_AUDIT');
          else if (id === 'admin') openMode('ADMIN_CONSOLE');
        }}
        user={{ name: sessionUser?.name || bootstrap?.user.displayName || 'Verifierad anvandare' }}
        organisationName={bootstrap?.organisation.name}
        activeProjectLabel={activeProject?.propertyDesignation || null}
        moduleAccess={bootstrap?.moduleAccess}
        projectCount={bootstrap?.projects.length || 0}
        integrationStatus={bootstrap?.integrationAvailability.app.reason}
      />
    );
  }

  const activeMode = modeCardMap[mode];

  return (
    <div
      data-testid="app-workspace-shell"
      className="min-h-screen flex overflow-hidden font-['Plus_Jakarta_Sans'] bg-slate-50"
    >
      <AppSidebar
        mode={mode}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        setMode={setMode}
        bootstrap={bootstrap}
        activeMode={activeMode}
        modeCards={MODE_CARDS}
        openMode={openMode}
        setShowUpload={setShowUpload}
      />

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <AppHeader
          activeTab={activeTab}
          activeMode={activeMode}
          readyModuleCount={readyModuleCount}
          totalModuleCount={plan.moduleIntegrations.length}
          blockedModuleCount={blockedModuleCount}
          passedGateCount={passedGateCount}
          requiredGateCount={requiredGateCount}
          carbonReady={carbonReady}
          activeProjectLabel={activeProject?.propertyDesignation || null}
        />

        <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar relative">{renderContent()}</div>
        <ChatBot />
      </main>

      {selectedPermit && <DetailModal permit={selectedPermit} onClose={() => setSelectedPermit(null)} />}
      {showUpload && (
        <UploadModal
          onComplete={(partial) => {
            setShowUpload(false);
            // If we got permit data back, navigate to apply tab
            if (partial) setActiveTab('apply');
          }}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  );
};

export default App;
