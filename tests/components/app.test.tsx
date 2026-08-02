import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      <button data-testid="select-logistik" onClick={() => onSelectModule('logistik')}>
        Logistik
      </button>
      <button data-testid="select-unknown" onClick={() => onSelectModule('unknown')}>
        Unknown
      </button>
    </div>
  ),
}));

vi.mock('../../components/ExecutiveSummary', () => ({
  default: () => <div data-testid="executive-summary" />,
}));

vi.mock('../../components/ChatBot', () => ({
  default: () => <div data-testid="chat-bot" />,
}));

vi.mock('../../components/BankIDLogin', () => ({
  default: ({ onLogin }: { onLogin: (user: unknown) => void }) => (
    <button data-testid="bankid-login" onClick={() => onLogin({})}>
      Login
    </button>
  ),
}));

vi.mock('../../components/MarketIntelView', () => ({
  default: () => <div data-testid="market-intel-view" />,
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
vi.mock('../../components/AdminSearchConsole', () => ({
  default: () => <div data-testid="admin-search-console" />,
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

const dashboardBootstrap: AppBootstrapResponse = {
  ...bootstrap,
  activeProjectId: null,
};

function renderApp() {
  return render(
    <ProjectStructureProvider>
      <App />
    </ProjectStructureProvider>,
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreApiClientMocks.getToken.mockReturnValue('test-token');
    coreApiClientMocks.getActiveProjectId.mockReturnValue('proj-1');
    coreApiClientMocks.callApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/app/bootstrap') {
        return { ok: true, bootstrap: dashboardBootstrap };
      }
      if (endpoint === '/api/permits') {
        return { ok: true, permits: [] };
      }
      return { ok: true };
    });
    coreApiClientMocks.refreshAccessSession.mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
    });
  });

  it('renders dashboard after verified bootstrap', async () => {
    renderApp();
    expect(await screen.findByTestId('dashboard-hub')).toBeInTheDocument();
  });

  it('keeps dashboard visible for unknown module ids', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByTestId('select-unknown'));
    expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument();
    expect(screen.queryByTestId('executive-summary')).not.toBeInTheDocument();
  });

  it('opens logistics mode when the dashboard selects logistik', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByTestId('select-logistik'));
    expect(await screen.findByTestId('executive-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-hub')).not.toBeInTheDocument();
  });

  it('falls back to BankID login when no token exists', async () => {
    coreApiClientMocks.getToken.mockReturnValue('');
    renderApp();
    expect(screen.getByTestId('bankid-login')).toBeInTheDocument();
  });
});
