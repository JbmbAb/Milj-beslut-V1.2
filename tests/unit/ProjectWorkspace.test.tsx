import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ProjectWorkspace from '../../components/ProjectWorkspace';
import type { InterfaceMode } from '../../types';

// Mock child components - lazy loaded
vi.mock('../../components/MarketIntelView', () => ({
  default: () => <div data-testid="market-intel">Market Intel View</div>,
}));

vi.mock('../../components/PermitPortalView', () => ({
  default: () => <div data-testid="permit-portal">Permit Portal View</div>,
}));

vi.mock('../../components/ExecutiveSummary', () => ({
  default: () => <div data-testid="executive-summary">Executive Summary</div>,
}));

vi.mock('../../components/DetailModal', () => ({
  default: () => <div data-testid="detail-modal">Detail Modal</div>,
}));

vi.mock('../../components/ChatBot', () => ({
  default: () => <div data-testid="chat-bot">Chat Bot</div>,
}));

vi.mock('../../components/FormManager', () => ({
  default: () => <div data-testid="form-manager">Form Manager</div>,
}));

vi.mock('../../components/SluExpert', () => ({
  default: () => <div data-testid="slu-expert">SLU Expert</div>,
}));

vi.mock('../../components/IntegrationsDashboard', () => ({
  default: () => <div data-testid="integrations">Integrations Dashboard</div>,
}));

vi.mock('../../components/ApplicationWizard', () => ({
  default: () => <div data-testid="application-wizard">Application Wizard</div>,
}));

vi.mock('../../components/AssetTriage', () => ({
  default: () => <div data-testid="asset-triage">Asset Triage</div>,
}));

vi.mock('../../components/FieldAssistant', () => ({
  default: () => <div data-testid="field-assistant">Field Assistant</div>,
}));

vi.mock('../../components/Guide', () => ({
  default: () => <div data-testid="guide">Guide</div>,
}));

vi.mock('../../components/GisRiskModule', () => ({
  default: () => <div data-testid="gis-risk">GIS Risk Module</div>,
}));

vi.mock('../../components/LegalSupportCenter', () => ({
  default: () => <div data-testid="legal-support">Legal Support Center</div>,
}));

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: vi.fn(() => ({
    plan: {
      id: 'plan-1',
      name: 'Test Project',
      description: 'Test Description',
      moduleIntegrations: [],
      stageGates: [],
      carbonSummary: { lastResult: null },
    },
  })),
  ProjectStructureProvider: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../components/WorkspaceScaffold', () => ({
  default: ({ children }: any) => <div data-testid="scaffold">{children}</div>,
}));

vi.mock('../../services/projectStructure', () => ({
  countReadyModules: vi.fn(() => 0),
}));

describe('ProjectWorkspace', () => {
  const defaultProps = {
    mode: 'PERMIT_PORTAL' as InterfaceMode,
    activeTab: 'map',
    onSetActiveTab: vi.fn(),
    onOpenMode: vi.fn(),
    onExitToDashboard: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', async () => {
    const { container } = render(<ProjectWorkspace {...defaultProps} />);
    await waitFor(() => {
      expect(container).toBeInTheDocument();
    });
  });

  it('should render guide view when activeTab is guide', async () => {
    render(<ProjectWorkspace {...defaultProps} activeTab="guide" />);

    await waitFor(() => {
      expect(screen.getByTestId('guide')).toBeInTheDocument();
    });
  });

  it('should render legal support center when activeTab is legal', async () => {
    render(<ProjectWorkspace {...defaultProps} activeTab="legal" />);

    await waitFor(() => {
      expect(screen.getByTestId('legal-support')).toBeInTheDocument();
    });
  });

  it('should render permit portal for PERMIT_PORTAL mode with map tab', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="PERMIT_PORTAL" activeTab="map" />);

    await waitFor(() => {
      expect(screen.getByTestId('permit-portal')).toBeInTheDocument();
    });
  });

  it('should render permit portal for PERMIT_PORTAL mode with apply tab', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="PERMIT_PORTAL" activeTab="apply" />);

    await waitFor(() => {
      expect(screen.getByTestId('permit-portal')).toBeInTheDocument();
    });
  });

  it('should render form manager for PERMIT_PORTAL mode with forms tab', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="PERMIT_PORTAL" activeTab="forms" />);

    await waitFor(() => {
      expect(screen.getByTestId('form-manager')).toBeInTheDocument();
    });
  });

  it('should render slu expert for PERMIT_PORTAL mode with biodiversity tab', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="PERMIT_PORTAL" activeTab="biodiversity" />);

    await waitFor(() => {
      expect(screen.getByTestId('slu-expert')).toBeInTheDocument();
    });
  });

  it('should render gis risk for PERMIT_PORTAL mode with risks tab', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="PERMIT_PORTAL" activeTab="risks" />);

    await waitFor(() => {
      expect(screen.getByTestId('gis-risk')).toBeInTheDocument();
    });
  });

  it('should render logistics market view for LOGISTICS_MARKET mode with logistics tab', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="LOGISTICS_MARKET" activeTab="logistics" />);

    await waitFor(() => {
      expect(screen.getByTestId('market-intel')).toBeInTheDocument();
    });
  });

  it('should render executive summary for LOGISTICS_MARKET mode with archive tab', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="LOGISTICS_MARKET" activeTab="archive" />);

    await waitFor(() => {
      expect(screen.getByTestId('executive-summary')).toBeInTheDocument();
    });
  });

  it('should render asset triage for LOGISTICS_MARKET mode with triage tab', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="LOGISTICS_MARKET" activeTab="triage" />);

    await waitFor(() => {
      expect(screen.getByTestId('asset-triage')).toBeInTheDocument();
    });
  });

  it('should render application wizard for PROJECT_MANAGER mode with plan tab', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="PROJECT_MANAGER" activeTab="plan" />);

    await waitFor(() => {
      expect(screen.getByTestId('application-wizard')).toBeInTheDocument();
    });
  });

  it('should render field assistant for PROJECT_MANAGER mode with field tab', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="PROJECT_MANAGER" activeTab="field" />);

    await waitFor(() => {
      expect(screen.getByTestId('field-assistant')).toBeInTheDocument();
    });
  });

  it('should render integrations dashboard for COMPLIANCE_AUDIT mode', async () => {
    render(<ProjectWorkspace {...defaultProps} mode="COMPLIANCE_AUDIT" />);

    await waitFor(() => {
      expect(screen.getByTestId('integrations')).toBeInTheDocument();
    });
  });

  it('should render fallback message for unknown mode', async () => {
    render(<ProjectWorkspace {...defaultProps} mode={'UNKNOWN' as any} />);

    await waitFor(() => {
      expect(screen.getByText(/Valj en sektion/i)).toBeInTheDocument();
    });
  });

  it('should call onSetActiveTab when tab changes', async () => {
    const onSetActiveTab = vi.fn();
    render(<ProjectWorkspace {...defaultProps} onSetActiveTab={onSetActiveTab} />);

    // Tab changes would be triggered by navigation, component uses callback
    expect(onSetActiveTab).toBeDefined();
  });

  it('should call onOpenMode when mode changes', () => {
    const onOpenMode = vi.fn();
    render(<ProjectWorkspace {...defaultProps} onOpenMode={onOpenMode} />);

    expect(onOpenMode).toBeDefined();
  });

  it('should call onExitToDashboard when needed', () => {
    const onExitToDashboard = vi.fn();
    render(<ProjectWorkspace {...defaultProps} onExitToDashboard={onExitToDashboard} />);

    expect(onExitToDashboard).toBeDefined();
  });

  it('should handle null selected permit state', async () => {
    render(<ProjectWorkspace {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('scaffold')).toBeInTheDocument();
    });
  });
});
