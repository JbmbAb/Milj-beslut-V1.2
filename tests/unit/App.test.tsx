import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import App from '../../components/App';
import { ProjectStructureProvider } from '../../components/ProjectStructureContext';
import type { AppBootstrapResponse } from '../../types';

const coreApiClientMocks = vi.hoisted(() => ({
  callApi: vi.fn(),
  clearSession: vi.fn(),
  getActiveProjectId: vi.fn(() => 'proj-1'),
  getToken: vi.fn(() => 'test-token'),
  refreshAccessSession: vi.fn(),
  setActiveProjectId: vi.fn(),
}));

vi.mock('../../components/PriorityModulePortfolio', () => ({
  PriorityModulePortfolio: () => <div data-testid="priority-module-portfolio" />,
}));

vi.mock('../../components/admin/modules/c-notification-mass/CNotificationMassUI', () => ({
  CNotificationMassUI: () => <div data-testid="c-notification-mass-ui" />,
}));

vi.mock('../../services/coreApiClient', () => ({
  callApi: coreApiClientMocks.callApi,
  clearSession: coreApiClientMocks.clearSession,
  getActiveProjectId: coreApiClientMocks.getActiveProjectId,
  getToken: coreApiClientMocks.getToken,
  refreshAccessSession: coreApiClientMocks.refreshAccessSession,
  setActiveProjectId: coreApiClientMocks.setActiveProjectId,
}));

vi.mock('../../components/TechnicalDashboardHub', () => ({
  TechnicalDashboardHub: ({ onSelectModule }: { onSelectModule: (id: string) => void }) => (
    <div data-testid="dashboard-hub">
      <button onClick={() => onSelectModule('core')} data-testid="select-core">
        Core
      </button>
      <button onClick={() => onSelectModule('ansokan')} data-testid="select-ansokan">
        Ansokan
      </button>
      <button onClick={() => onSelectModule('logistik')} data-testid="select-logistik">
        Logistik
      </button>
      <button onClick={() => onSelectModule('admin')} data-testid="select-admin">
        Admin
      </button>
    </div>
  ),
}));

vi.mock('../../components/ExecutiveSummary', () => ({
  default: () => <div data-testid="executive-summary" />,
}));

vi.mock('../../components/AdminSearchConsole', () => ({
  default: () => <div data-testid="admin-search-console" />,
}));

vi.mock('../../components/ChatBot', () => ({
  default: () => <div data-testid="chat-bot" />,
}));

vi.mock('../../components/BankIDLogin', () => ({
  default: () => <div data-testid="bankid-login" />,
}));

vi.mock('../../components/MarketIntelView', () => ({
  default: () => <div data-testid="market-intel-view" />,
}));
vi.mock('../../components/PermitPortalView', () => ({
  default: () => <div data-testid="permit-portal-view" />,
}));
vi.mock('../../components/DetailModal', () => ({ default: () => <div data-testid="detail-modal" /> }));
vi.mock('../../components/FormManager', () => ({ default: () => <div data-testid="form-manager" /> }));
vi.mock('../../components/SluExpert', () => ({ default: () => <div data-testid="slu-expert" /> }));
vi.mock('../../components/IntegrationsDashboard', () => ({
  default: () => <div data-testid="integrations-dashboard" />,
}));
vi.mock('../../components/AssetTriage', () => ({ default: () => <div data-testid="asset-triage" /> }));
vi.mock('../../components/FieldAssistant', () => ({ default: () => <div data-testid="field-assistant" /> }));
vi.mock('../../components/Guide', () => ({ default: () => <div data-testid="guide" /> }));
vi.mock('../../components/GisRiskModule', () => ({ default: () => <div data-testid="gis-risk-module" /> }));
vi.mock('../../components/LegalSupportCenter', () => ({
  default: () => <div data-testid="legal-support-center" />,
}));
vi.mock('../../components/CoreWorkflowView', () => ({
  default: () => <div data-testid="core-workflow-view" />,
  CoreWorkflowView: () => <div data-testid="core-workflow-view" />,
}));
vi.mock('../../components/AdminMetadataReview', () => ({
  default: () => <div data-testid="admin-metadata-review" />,
}));
vi.mock('../../components/AdminGdprPanel', () => ({ default: () => <div data-testid="admin-gdpr-panel" /> }));
vi.mock('../../components/AdminDbStatusPanel', () => ({
  default: () => <div data-testid="admin-db-status-panel" />,
}));
vi.mock('../../components/SystemFunctionalAnalysis', () => ({
  default: () => <div data-testid="system-functional-analysis" />,
}));
vi.mock('../../components/AppReadinessPanel', () => ({
  default: () => <div data-testid="app-readiness-panel" />,
}));
vi.mock('../../components/MarketingHub', () => ({ default: () => <div data-testid="marketing-hub" /> }));
vi.mock('../../components/UploadModal', () => ({ default: () => <div data-testid="upload-modal" /> }));
vi.mock('../../components/ProjectManagerView', () => ({
  default: () => <div data-testid="project-manager-view" />,
}));

const bootstrap: AppBootstrapResponse = {
  user: {
    id: 'user-1',
    displayName: 'Ada Admin',
    bankidId: 'admin:test',
    role: 'ADMIN',
    organisationId: 'org-1',
  },
  organisation: {
    id: 'org-1',
    name: 'Miljöbeslut AB',
    orgNumber: '556677-8899',
  },
  projects: [
    {
      id: 'proj-1',
      propertyDesignation: 'Demo 1:1',
      status: 'ACTIVE',
      createdAt: '2026-04-02T00:00:00.000Z',
      complianceScore: null,
      environmentalScore: null,
      fundingRating: null,
      regulatoryRiskScore: null,
      documentCount: 0,
      memberCount: 1,
      lastPlanUpdatedAt: null,
    },
  ],
  activeProjectId: 'proj-1',
  moduleAccess: [],
  integrationAvailability: {
    app: { status: 'ready', reason: 'Serververifierad session', checkedAt: '2026-04-02T00:00:00.000Z' },
    dispatch: { status: 'ready', reason: 'Dispatch verifierad', checkedAt: '2026-04-02T00:00:00.000Z' },
    bankId: { status: 'ready', reason: 'BankID verifierad', checkedAt: '2026-04-02T00:00:00.000Z' },
    dataSources: { status: 'ready', reason: 'Datakallor verifierade', checkedAt: '2026-04-02T00:00:00.000Z' },
  },
  uiCapabilities: {
    authenticated: true,
    canCreateProjects: true,
    bankIdMode: 'real',
    requiresProjectSelection: false,
  },
  checkedAt: '2026-04-02T00:00:00.000Z',
};

function renderApp() {
  return render(
    <ProjectStructureProvider>
      <App />
    </ProjectStructureProvider>,
  );
}

describe('App component', () => {
  vi.setConfig({ testTimeout: 15000 });
  beforeEach(() => {
    vi.clearAllMocks();
    coreApiClientMocks.getToken.mockReturnValue('test-token');
    coreApiClientMocks.getActiveProjectId.mockReturnValue('proj-1');
    coreApiClientMocks.callApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/app/bootstrap') {
        return { ok: true, bootstrap };
      }
      if (endpoint === '/api/permits') {
        return { ok: true, permits: [] };
      }
      return { ok: true };
    });
  });

  it('opens Huvudmoduler by default when an active project exists', async () => {
    renderApp();
    expect(await screen.findByTestId('priority-module-portfolio')).toBeInTheDocument();
  });

  it('renders TechnicalDashboardHub when no active project exists', async () => {
    coreApiClientMocks.callApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/app/bootstrap') {
        return {
          ok: true,
          bootstrap: {
            ...bootstrap,
            activeProjectId: null,
          },
        };
      }
      if (endpoint === '/api/permits') {
        return { ok: true, permits: [] };
      }
      return { ok: true };
    });

    renderApp();
    expect(await screen.findByTestId('dashboard-hub')).toBeInTheDocument();
  });

  it('opens logistics summary when selecting logistik', async () => {
    const user = userEvent.setup();
    coreApiClientMocks.callApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/app/bootstrap') {
        return { ok: true, bootstrap: { ...bootstrap, activeProjectId: null } };
      }
      if (endpoint === '/api/permits') {
        return { ok: true, permits: [] };
      }
      return { ok: true };
    });
    renderApp();
    await user.click(await screen.findByTestId('select-logistik'));
    expect(await screen.findByTestId('executive-summary')).toBeInTheDocument();
  });

  it('opens Core workflow when selecting core', async () => {
    const user = userEvent.setup();
    coreApiClientMocks.callApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/app/bootstrap') {
        return { ok: true, bootstrap: { ...bootstrap, activeProjectId: null } };
      }
      if (endpoint === '/api/permits') {
        return { ok: true, permits: [] };
      }
      return { ok: true };
    });
    renderApp();
    await user.click(await screen.findByTestId('select-core'));
    expect(await screen.findByTestId('priority-module-portfolio')).toBeInTheDocument();
  });

  it('opens C-anmalan mass when selecting ansokan', async () => {
    const user = userEvent.setup();
    coreApiClientMocks.callApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/app/bootstrap') {
        return { ok: true, bootstrap: { ...bootstrap, activeProjectId: null } };
      }
      if (endpoint === '/api/permits') {
        return { ok: true, permits: [] };
      }
      return { ok: true };
    });
    renderApp();
    await user.click(await screen.findByTestId('select-ansokan'));
    expect(await screen.findByTestId('c-notification-mass-ui')).toBeInTheDocument();
  });

  it('opens admin console when selecting admin', async () => {
    const user = userEvent.setup();
    coreApiClientMocks.callApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/app/bootstrap') {
        return { ok: true, bootstrap: { ...bootstrap, activeProjectId: null } };
      }
      if (endpoint === '/api/permits') {
        return { ok: true, permits: [] };
      }
      return { ok: true };
    });
    renderApp();
    await user.click(await screen.findByTestId('select-admin'));
    expect(await screen.findByTestId('admin-search-console')).toBeInTheDocument();
  });

  it('renders login state when no bearer token exists', () => {
    coreApiClientMocks.getToken.mockReturnValue('');
    renderApp();
    expect(screen.getByTestId('bankid-login')).toBeInTheDocument();
  });
});
