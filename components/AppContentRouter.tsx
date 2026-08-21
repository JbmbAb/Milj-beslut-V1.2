import React from 'react';
import { InterfaceMode, Permit } from '../types';
import RequirementChecklist from './RequirementChecklist';

import ExecutiveSummary from './ExecutiveSummary';
import IntegrationsDashboard from './IntegrationsDashboard';
import AssetTriage from './AssetTriage';
import FieldAssistant from './FieldAssistant';
import GisRiskModule from './GisRiskModule';
import AdminMetadataReview from './AdminMetadataReview';
import AdminSearchConsole from './AdminSearchConsole';
import AdminGdprPanel from './AdminGdprPanel';
import AdminDbStatusPanel from './AdminDbStatusPanel';
import SystemFunctionalAnalysis from './SystemFunctionalAnalysis';
import AppReadinessPanel from './AppReadinessPanel';
import MarketingHub from './MarketingHub';
import ProjectManagerView from './ProjectManagerView';
import { LuWorkspace } from './app/lu/LuWorkspace';
import { CNotificationUI } from './CNotificationUI';
import { CNotificationMassUI } from './admin/modules/c-notification-mass/CNotificationMassUI';
import { PriorityModulePortfolio } from './PriorityModulePortfolio';
import SewagePortalView from './admin/modules/sewage-portal/SewagePortalView';
import { DossierDashboard } from './DossierDashboard';

import { MimerSearchUI } from './MimerSearchUI';
import { LegalSupportView } from './legal/LegalSupportView';

export interface AppContentRouterProps {
  mode: InterfaceMode | null;
  activeTab: string;
  permits: Permit[];
  setSelectedPermit: (p: Permit) => void;
  setActiveTab: (tab: string) => void;
  onOpenMassModule?: () => void;
}

export const AppContentRouter: React.FC<AppContentRouterProps> = ({
  mode,
  activeTab,
  permits,
  setSelectedPermit,
  setActiveTab,
  onOpenMassModule: _onOpenMassModule,
}) => {
  const normalizedMode = mode;
  const normalizedTab = activeTab;

  if (normalizedTab === 'requirements') return <RequirementChecklist code={{ code: "dummy", name: "dummy" } as any} />;
  if (normalizedTab === 'integrations') return <IntegrationsDashboard />;
  if (normalizedTab === 'dossier') return <DossierDashboard />;
  // "Juridiskt Stöd" (AppSidebar.tsx) is rendered outside any mode conditional -- so this tab is
  // handled mode-independently too, same as the three checks above.
  if (normalizedTab === 'legal') return <LegalSupportView />;

  switch (normalizedMode) {
    case 'PERMIT_PORTAL':
      if (normalizedTab === 'apply') {
        return <CNotificationMassUI />;
      }
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
          <p className="text-sm">Legacy-vy borttagen</p>
        </div>
      );
    case 'Core_WORKFLOW':
      if (normalizedTab === 'sewage-application') return <SewagePortalView />;
      if (normalizedTab === 'localization') return <LuWorkspace />;
      if (normalizedTab === 'c-notification-mass') return <CNotificationMassUI />;
      if (normalizedTab === 'c-notification-chemicals') return <CNotificationUI />;
      if (normalizedTab === 'mimer-search') return <MimerSearchUI />;
      return <PriorityModulePortfolio onNavigate={setActiveTab} />;
    case 'LOGISTICS_MARKET':
      if (normalizedTab === 'archive') return <ExecutiveSummary />;
      if (normalizedTab === 'logistics')
        return <div className="p-4 text-slate-500">Logistics (Legacy) view removed. Use MpsConsole.</div>;
      if (normalizedTab === 'triage') return <AssetTriage />;
      if (normalizedTab === 'marketing') return <MarketingHub permits={permits} fullView />;
      return <ExecutiveSummary />;
    case 'PROJECT_MANAGER':
      if (normalizedTab === 'field') return <FieldAssistant />;
      return <ProjectManagerView activeTab={normalizedTab} />;
    case 'COMPLIANCE_AUDIT':
      if (normalizedTab === 'score') return <GisRiskModule permits={permits} />;
      if (normalizedTab === 'audit') return <AdminMetadataReview />;
      if (normalizedTab === 'reports') return <ExecutiveSummary />;
      return <IntegrationsDashboard />;
    case 'ADMIN_CONSOLE':
      if (normalizedTab === 'admin-review') return <AdminMetadataReview />;
      if (normalizedTab === 'admin-gdpr') return <AdminGdprPanel />;
      if (normalizedTab === 'admin-db') return <AdminDbStatusPanel />;
      if (normalizedTab === 'admin-insight') return <AdminSearchConsole panel="insight" />;
      if (normalizedTab === 'admin-system') return <SystemFunctionalAnalysis />;
      if (normalizedTab === 'admin-readiness') return <AppReadinessPanel />;
      return <AdminSearchConsole panel="search" />;
    default:
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
          <i className="fas fa-layer-group text-4xl mb-4 opacity-20" />
          <p className="text-sm font-bold uppercase tracking-widest">Välj en sektion i menyn</p>
        </div>
      );
  }
};
