import React from 'react';
import PermitPortalModule from './modules/permit-portal/PermitPortalModule';
import LogisticsModule from './modules/logistics/LogisticsModule';
import ProjectPlanModule from './modules/project-plan/ProjectPlanModule';
import GreenCheckModule from './modules/green-check/GreenCheckModule';
import SewagePortalModule from './modules/sewage-portal/SewagePortalModule';
import AdminDbStatusPanel from '../AdminDbStatusPanel';
import AdminMpfStudio from '../AdminMpfStudio';
import { AdminModuleId } from './AdminShell';

interface ModuleRouterProps {
  moduleId: AdminModuleId;
}

/**
 * ModuleRouter – Villkorlig rendering av moduler baserat på ID
 * Hanterar modulväxling utan navigation
 */
const ModuleRouter: React.FC<ModuleRouterProps> = ({ moduleId }) => {
  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('admin-token') || '' : '';
  const noop = () => {};

  switch (moduleId) {
    case 'permit-portal':
      return <PermitPortalModule />;
    case 'logistics':
      return <LogisticsModule />;
    case 'project-plan':
      return <ProjectPlanModule />;
    case 'green-check':
      return <GreenCheckModule />;
    case 'sewage-portal':
      return <SewagePortalModule />;
    case 'operations':
      return (
        <div className="space-y-6 p-4">
          <AdminDbStatusPanel />
          <AdminMpfStudio token={adminToken} onError={noop} onInfo={noop} />
        </div>
      );
    default:
      return <div>Okänd modul</div>;
  }
};

export default ModuleRouter;
