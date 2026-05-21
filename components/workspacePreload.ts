import type { InterfaceMode } from '../types';
import { MODE_CARDS } from './workspaceModes';

const loadProjectWorkspace = () => import('./ProjectWorkspace');
const loadStandaloneWorkspace = () => import('./StandaloneWorkspace');
const loadExecutiveSummary = () => import('./ExecutiveSummary');
const loadPermitPortalView = () => import('./PermitPortalView');
const loadApplicationWizard = () => import('./ApplicationWizard');
const loadGisRiskModule = () => import('./GisRiskModule');
const loadAdminSearchConsole = () => import('./AdminSearchConsole');
const loadAdminSessionConsole = () => import('./admin/AdminSessionConsole');
const loadAdminSearchPanelView = () => import('./admin/AdminSearchPanelView');
const loadCoreWorkflowView = () => import('./CoreWorkflowView');

function needsProjectStructure(mode: InterfaceMode, activeTab: string): boolean {
  if (activeTab === 'guide') return true;
  return (
    mode === 'LOGISTICS_MARKET' ||
    mode === 'PERMIT_PORTAL' ||
    mode === 'PROJECT_MANAGER' ||
    mode === 'COMPLIANCE_AUDIT'
  );
}

function preloadDefaultView(mode: InterfaceMode): Promise<unknown> {
  switch (mode) {
    case 'LOGISTICS_MARKET':
      return loadExecutiveSummary();
    case 'PERMIT_PORTAL':
      return loadPermitPortalView();
    case 'PROJECT_MANAGER':
      return loadApplicationWizard();
    case 'COMPLIANCE_AUDIT':
      return loadGisRiskModule();
    case 'ADMIN_CONSOLE':
      return Promise.all([loadAdminSearchConsole(), loadAdminSessionConsole(), loadAdminSearchPanelView()]);
    case 'Core_WORKFLOW':
      return loadCoreWorkflowView();
    default:
      return Promise.resolve();
  }
}

export function preloadWorkspaceForMode(mode: InterfaceMode): Promise<unknown> {
  const initialConfig = MODE_CARDS.find((item) => item.mode === mode);
  const initialTab = initialConfig?.defaultTab || 'summary';
  const workspacePromise = needsProjectStructure(mode, initialTab)
    ? loadProjectWorkspace()
    : loadStandaloneWorkspace();
  return Promise.all([workspacePromise, preloadDefaultView(mode)]);
}

export { loadProjectWorkspace, loadStandaloneWorkspace, needsProjectStructure };
