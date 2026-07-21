import React from 'react';
import { InterfaceMode, Permit } from '../types';

import MarketIntelView from './MarketIntelView';
import ExecutiveSummary from './ExecutiveSummary';
import IntegrationsDashboard from './IntegrationsDashboard';
import AssetTriage from './AssetTriage';
import FieldAssistant from './FieldAssistant';
import Guide from './Guide';
import GisRiskModule from './GisRiskModule';
import LegalSupportCenter from './LegalSupportCenter';
import AdminMetadataReview from './AdminMetadataReview';
import AdminSearchConsole from './AdminSearchConsole';
import AdminGdprPanel from './AdminGdprPanel';
import AdminDbStatusPanel from './AdminDbStatusPanel';
import SystemFunctionalAnalysis from './SystemFunctionalAnalysis';
import AppReadinessPanel from './AppReadinessPanel';
import MarketingHub from './MarketingHub';
import ProjectManagerView from './ProjectManagerView';
import { LocalizationStudyUI } from './LocalizationStudyUI';
import { CNotificationUI } from './CNotificationUI';
import { CNotificationMassUI } from './admin/modules/c-notification-mass/CNotificationMassUI';
import { PriorityModulePortfolio } from './PriorityModulePortfolio';
import SewagePortalView from './admin/modules/sewage-portal/SewagePortalView';
import { DossierDashboard } from './DossierDashboard';

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

  if (normalizedTab === 'guide') return <Guide mode={normalizedMode} onNavigate={setActiveTab} />;
  if (normalizedTab === 'legal') return <LegalSupportCenter />;
  if (normalizedTab === 'integrations') return <IntegrationsDashboard />;
  if (normalizedTab === 'dossier') return <DossierDashboard />;

  switch (normalizedMode) {
    case 'Core_WORKFLOW':
      if (normalizedTab === 'sewage-application') return <SewagePortalView />;
      if (normalizedTab === 'localization') return <LocalizationStudyUI />;
      if (normalizedTab === 'c-notification-mass') return <CNotificationMassUI />;
      if (normalizedTab === 'c-notification-chemicals') return <CNotificationUI />;
      return <PriorityModulePortfolio onNavigate={setActiveTab} />;
    case 'LOGISTICS_MARKET':
      if (normalizedTab === 'archive') return <ExecutiveSummary />;
      if (normalizedTab === 'logistics')
        return <MarketIntelView permits={permits} onSelectPermit={setSelectedPermit} mode="logistics" />;
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
