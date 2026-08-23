import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../components/App';
import { ProjectStructureProvider } from '../../components/ProjectStructureContext';
import type { AppBootstrapResponse } from '../../types';

const coreApiClientMocks = vi.hoisted(() => ({
  callApi: vi.fn(),
  clearSession: vi.fn(),
  getActiveProjectId: vi.fn(() => 'proj-1'),
  getToken: vi.fn(() => 'test-token'),
  getRefreshToken: vi.fn(() => 'refresh-token'),
  refreshAccessSession: vi.fn(),
  setActiveProjectId: vi.fn(),
  setSession: vi.fn(),
}));

vi.mock('../../services/coreApiClient', () => ({
  callApi: coreApiClientMocks.callApi,
  clearSession: coreApiClientMocks.clearSession,
  getActiveProjectId: coreApiClientMocks.getActiveProjectId,
  getToken: coreApiClientMocks.getToken,
  getRefreshToken: coreApiClientMocks.getRefreshToken,
  refreshAccessSession: coreApiClientMocks.refreshAccessSession,
  setActiveProjectId: coreApiClientMocks.setActiveProjectId,
  setSession: coreApiClientMocks.setSession,
}));

vi.mock('@miljobeslut/mps-console', async () => {
  const actual = await vi.importActual<typeof import('@miljobeslut/mps-console')>(
    '@miljobeslut/mps-console',
  );
  return {
    ...actual,
    uiConfig: { enableLegacyUi: false },
    MpsConsoleApp: () => <div data-testid="mps-console-stub">Console</div>,
  };
});

vi.mock('@miljobeslut/mps-compass', () => ({
  MpsCompass: () => <div data-testid="mps-compass" />,
}));

vi.mock('@miljobeslut/mps-identity', () => ({
  designTokens: {
    colors: {
      surfaceDarkStone: { hex: '#1C1C1E' },
      coreTurquoise: { hex: '#40E0D0' },
      flowLightCyan: { hex: '#E0FFFF' },
      coreGraphite: { hex: '#2C2C2E' },
      statusAudit: { hex: '#F0E68C' },
    },
  },
}));

vi.mock('../../components/app/lu/LuWorkspace', () => ({
  LuWorkspace: () => <div data-testid="lu-workspace" />,
}));

vi.mock('../../src/ui/api-client/localizationProjects.client', () => ({
  listPropertyProjects: vi.fn(async () => [
    { id: 'proj-1', name: 'Alternativ A', propertyDesignation: 'ORSA STACKMORA 3:12', status: 'ACTIVE', createdAt: '2026-04-02T00:00:00.000Z' },
  ]),
  createLocalizationProjectRequest: vi.fn(),
  getBootstrapStatus: vi.fn(),
  retryLocalizationBootstrap: vi.fn(),
}));

// PRODUCT-LEGACY-DEAD-SURFACE-CLEANUP-01: SewagePortalView/CNotificationMassUI/
// TechnicalDashboardHub/ChatBot/DetailModal/UploadModal mocks removed -- AppShell.tsx no longer
// imports any of them (PRODUCT-UI-LEGACY-ISOLATION-01), and TechnicalDashboardHub.tsx itself no
// longer exists in the repo (confirmed zero real importers before deletion).

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
    orgNumber: '5566628899',
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectStructureProvider>
        <App />
      </ProjectStructureProvider>
    </QueryClientProvider>,
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
      if (endpoint === '/api/auth/bankid/status') {
        return { ok: true, mode: 'mock', canInitiate: false, message: 'test', allowDevLogin: true };
      }
      return { ok: true };
    });
    coreApiClientMocks.refreshAccessSession.mockResolvedValue({
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
    });
  });

  it('renders MimerProductShell after verified bootstrap', async () => {
    renderApp();
    expect(await screen.findByTestId('mimer-product-shell')).toBeInTheDocument();
    expect(screen.getByTestId('product-home')).toBeInTheDocument();
  });

  it('navigates to localization from product shell and reaches LuWorkspace after a property is opened', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByTestId('nav-localization'));
    expect(await screen.findByTestId('product-localization')).toBeInTheDocument();
    expect(screen.getByTestId('lu-property-first-entry')).toBeInTheDocument();

    await user.type(screen.getByTestId('pf-designation'), 'ORSA STACKMORA 3:12');
    await user.click(screen.getByTestId('pf-search'));
    await user.click(await screen.findByTestId('pf-open-proj-1'));

    expect(await screen.findByTestId('lu-workspace')).toBeInTheDocument();
  });

  it('falls back to login when no token exists', async () => {
    coreApiClientMocks.getToken.mockReturnValue('');
    renderApp();
    expect(await screen.findByTestId('app-login')).toBeInTheDocument();
    expect(screen.getByTestId('dev-login')).toBeInTheDocument();
  });

  it('does not render the dev-login shortcut when the server reports allowDevLogin=false (RC1 default posture)', async () => {
    coreApiClientMocks.getToken.mockReturnValue('');
    coreApiClientMocks.callApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/auth/bankid/status') {
        return { ok: true, mode: 'test', canInitiate: true, message: 'test', allowDevLogin: false };
      }
      return { ok: true };
    });
    renderApp();
    expect(await screen.findByTestId('app-login')).toBeInTheDocument();
    expect(screen.getByTestId('bankid-auth-interface')).toBeInTheDocument();
    expect(screen.queryByTestId('dev-login')).not.toBeInTheDocument();
  });

  it('renders the real AuthInterface (not an "unavailable" placeholder) when BankID canInitiate=true', async () => {
    coreApiClientMocks.getToken.mockReturnValue('');
    coreApiClientMocks.callApi.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/auth/bankid/status') {
        return { ok: true, mode: 'test', canInitiate: true, message: 'test', allowDevLogin: false };
      }
      return { ok: true };
    });
    renderApp();
    expect(await screen.findByTestId('bankid-auth-interface')).toBeInTheDocument();
    expect(screen.queryByTestId('bankid-unavailable')).not.toBeInTheDocument();
  });
});
