import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppContentRouter } from '../../components/AppContentRouter';

vi.mock('../../components/MarketIntelView', () => ({ default: () => <div data-testid="market-intel-view" /> }));
vi.mock('../../components/PermitPortalView', () => ({ default: () => <div data-testid="permit-portal-view" /> }));
vi.mock('../../components/ExecutiveSummary', () => ({ default: () => <div data-testid="executive-summary" /> }));
vi.mock('../../components/FormManager', () => ({ default: () => <div data-testid="form-manager" /> }));
vi.mock('../../components/SluExpert', () => ({ default: () => <div data-testid="slu-expert" /> }));
vi.mock('../../components/IntegrationsDashboard', () => ({ default: () => <div data-testid="integrations-dashboard" /> }));
vi.mock('../../components/AssetTriage', () => ({ default: () => <div data-testid="asset-triage" /> }));
vi.mock('../../components/FieldAssistant', () => ({ default: () => <div data-testid="field-assistant" /> }));
vi.mock('../../components/Guide', () => ({ default: () => <div data-testid="guide-view" /> }));
vi.mock('../../components/GisRiskModule', () => ({ default: () => <div data-testid="gis-risk-module" /> }));
vi.mock('../../components/LegalSupportCenter', () => ({ default: () => <div data-testid="legal-support-center" /> }));
vi.mock('../../components/CoreWorkflowView', () => ({ default: () => <div data-testid="core-workflow-view" /> }));
vi.mock('../../components/AdminMetadataReview', () => ({ default: () => <div data-testid="admin-metadata-review" /> }));
vi.mock('../../components/AdminSearchConsole', () => ({ default: () => <div data-testid="admin-search-console" /> }));
vi.mock('../../components/AdminGdprPanel', () => ({ default: () => <div data-testid="admin-gdpr-panel" /> }));
vi.mock('../../components/AdminDbStatusPanel', () => ({ default: () => <div data-testid="admin-db-panel" /> }));
vi.mock('../../components/SystemFunctionalAnalysis', () => ({ default: () => <div data-testid="system-functional-analysis" /> }));
vi.mock('../../components/AppReadinessPanel', () => ({ default: () => <div data-testid="app-readiness-panel" /> }));
vi.mock('../../components/MarketingHub', () => ({ default: () => <div data-testid="marketing-hub" /> }));
vi.mock('../../components/ProjectManagerView', () => ({ default: () => <div data-testid="project-manager-view" /> }));
vi.mock('../../components/LocalizationStudyUI', () => ({ LocalizationStudyUI: () => <div data-testid="localization-study-ui" /> }));
vi.mock('../../components/CNotificationUI', () => ({ CNotificationUI: () => <div data-testid="c-notification-ui" /> }));
vi.mock('../../components/PriorityModulePortfolio', () => ({ PriorityModulePortfolio: () => <div data-testid="priority-module-portfolio" /> }));
vi.mock('../../components/admin/modules/sewage-portal/SewagePortalView', () => ({ default: () => <div data-testid="sewage-portal-view" /> }));
vi.mock('../../components/admin/modules/c-notification-mass/CNotificationMassUI', () => ({
  CNotificationMassUI: () => <div data-testid="c-notification-mass-ui" />,
}));

describe('AppContentRouter', () => {
  const baseProps = {
    mode: 'Core_WORKFLOW' as const,
    activeTab: 'core',
    permits: [],
    setSelectedPermit: vi.fn(),
    setActiveTab: vi.fn(),
  };

  it('renders separate enskilt avlopp flow', () => {
    render(<AppContentRouter {...baseProps} activeTab="sewage-application" />);
    expect(screen.getByTestId('sewage-portal-view')).toBeInTheDocument();
  });

  it('renders separate C-anmalan flow', () => {
    render(<AppContentRouter {...baseProps} activeTab="c-notification-chemicals" />);
    expect(screen.getByTestId('c-notification-ui')).toBeInTheDocument();
  });

  it('renders separate lokaliseringsutredning flow', () => {
    render(<AppContentRouter {...baseProps} activeTab="localization" />);
    expect(screen.getByTestId('localization-study-ui')).toBeInTheDocument();
  });

  it('routes legacy PERMIT_PORTAL apply tab to C-anmalan mass', () => {
    render(
      <AppContentRouter
        {...baseProps}
        mode="PERMIT_PORTAL"
        activeTab="apply"
      />,
    );
    expect(screen.getByTestId('c-notification-mass-ui')).toBeInTheDocument();
  });
});
