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
const HIDE_LEGACY_PERMIT_PORTAL =
  String(import.meta.env.VITE_HIDE_LEGACY_PERMIT_PORTAL || '').toLowerCase() === 'true';

const LegacyPermitPortalNotice: React.FC = () => (
  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-6 text-sm" role="status">
    <p className="font-semibold text-amber-900 dark:text-amber-100">Tillståndsportalen (legacy) är avvecklad</p>
    <p className="mt-2 text-amber-950/80 dark:text-amber-50/80">
      Använd Core workflow och C-anmälan schaktmassor i huvudflödet. Se{' '}
      <code className="text-xs">docs/architecture/PERMIT_PORTAL_RETIREMENT_PLAN.md</code>.
    </p>
  </div>
);

const ModuleRouter: React.FC<ModuleRouterProps> = ({ moduleId }) => {
  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('admin-token') || '' : '';
  const noop = () => {};

  switch (moduleId) {
    case 'permit-portal':
      if (HIDE_LEGACY_PERMIT_PORTAL) {
        return <LegacyPermitPortalNotice />;
      }
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
