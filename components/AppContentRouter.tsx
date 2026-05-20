import React from 'react';
import { InterfaceMode, Permit } from '../types';

import MarketIntelView from './MarketIntelView';
import PermitPortalView from './PermitPortalView';
import ExecutiveSummary from './ExecutiveSummary';
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
import SystemFunctionalAnalysis from './SystemFunctionalAnalysis';
import AppReadinessPanel from './AppReadinessPanel';
import MarketingHub from './MarketingHub';
import ProjectManagerView from './ProjectManagerView';
import { LocalizationStudyUI } from './LocalizationStudyUI';
import { CNotificationUI } from './CNotificationUI';
import { CNotificationMassUI } from './admin/modules/c-notification-mass/CNotificationMassUI';
import { PriorityModulePortfolio } from './PriorityModulePortfolio';
import SewagePortalView from './admin/modules/sewage-portal/SewagePortalView';

export interface AppContentRouterProps {
  mode: InterfaceMode | null;
  activeTab: string;
  permits: Permit[];
  setSelectedPermit: (p: Permit) => void;
  setActiveTab: (tab: string) => void;
}

export const AppContentRouter: React.FC<AppContentRouterProps> = ({
  mode,
  activeTab,
  permits,
  setSelectedPermit,
  setActiveTab,
}) => {
  if (activeTab === 'guide') return <Guide mode={mode} onNavigate={setActiveTab} />;
  if (activeTab === 'legal') return <LegalSupportCenter />;
  if (activeTab === 'integrations') return <IntegrationsDashboard />;

  switch (mode) {
    case 'Core_WORKFLOW':
      if (activeTab === 'sewage-application') return <SewagePortalView />;
      if (activeTab === 'localization') return <LocalizationStudyUI />;
      if (activeTab === 'c-notification-mass') return <CNotificationMassUI />;
      if (activeTab === 'c-notification-chemicals') return <CNotificationUI />;
      return <PriorityModulePortfolio onNavigate={setActiveTab} />;
    case 'LOGISTICS_MARKET':
      if (activeTab === 'archive') return <ExecutiveSummary />;
      if (activeTab === 'logistics')
        return <MarketIntelView permits={permits} onSelectPermit={setSelectedPermit} mode="logistics" />;
      if (activeTab === 'triage') return <AssetTriage />;
      if (activeTab === 'marketing') return <MarketingHub permits={permits} fullView />;
      return <ExecutiveSummary />;
    case 'PERMIT_PORTAL':
      if (activeTab === 'map') return <PermitPortalView permits={permits} mode="map" />;
      if (activeTab === 'apply') return <PermitPortalView permits={permits} mode="apply" />;
      if (activeTab === 'forms') return <FormManager />;
      if (activeTab === 'biodiversity') return <SluExpert />;
      if (activeTab === 'risks') return <GisRiskModule permits={permits} />;
      return <PermitPortalView permits={permits} mode="map" />;
    case 'PROJECT_MANAGER':
      if (activeTab === 'field') return <FieldAssistant />;
      return <ProjectManagerView activeTab={activeTab} />;
    case 'COMPLIANCE_AUDIT':
      if (activeTab === 'score') return <GisRiskModule permits={permits} />;
      if (activeTab === 'audit') return <AdminMetadataReview />;
      if (activeTab === 'reports') return <ExecutiveSummary />;
      return <IntegrationsDashboard />;
    case 'ADMIN_CONSOLE':
      if (activeTab === 'admin-review') return <AdminMetadataReview />;
      if (activeTab === 'admin-gdpr') return <AdminGdprPanel />;
      if (activeTab === 'admin-db') return <AdminDbStatusPanel />;
      if (activeTab === 'admin-insight') return <AdminSearchConsole panel="insight" />;
      if (activeTab === 'admin-system') return <SystemFunctionalAnalysis />;
      if (activeTab === 'admin-readiness') return <AppReadinessPanel />;
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
