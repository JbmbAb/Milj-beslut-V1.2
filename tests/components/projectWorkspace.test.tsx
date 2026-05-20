import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/WorkspaceScaffold', () => ({
  default: ({
    mode,
    activeTab,
    children,
  }: {
    mode: string;
    activeTab: string;
    children: React.ReactNode;
  }) => (
    <div data-testid="workspace-scaffold" data-mode={mode} data-tab={activeTab}>
      {children}
    </div>
  ),
}));

vi.mock('../../components/ExecutiveSummary', () => ({
  default: () => <div data-testid="executive-summary" />,
}));

vi.mock('../../components/MarketIntelView', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid={`market-intel-${mode}`} />,
}));

vi.mock('../../components/PermitPortalView', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid={`permit-portal-${mode}`} />,
}));

vi.mock('../../components/AssetTriage', () => ({
  default: () => <div data-testid="asset-triage" />,
}));

vi.mock('../../components/ApplicationWizard', () => ({
  default: () => <div data-testid="application-wizard" />,
}));

vi.mock('../../components/GisRiskModule', () => ({
  default: () => <div data-testid="gis-risk-module" />,
}));

vi.mock('../../components/IntegrationsDashboard', () => ({
  default: () => <div data-testid="integrations-dashboard" />,
}));

vi.mock('../../components/Guide', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid={`guide-${mode}`} />,
}));

vi.mock('../../components/LegalSupportCenter', () => ({
  default: () => <div data-testid="legal-support-center" />,
}));

vi.mock('../../components/ChatBot', () => ({
  default: () => <div data-testid="chatbot" />,
}));

vi.mock('../../components/DetailModal', () => ({
  default: () => <div data-testid="detail-modal" />,
}));

vi.mock('../../components/FieldAssistant', () => ({
  default: () => <div data-testid="field-assistant" />,
}));

vi.mock('../../components/FormManager', () => ({
  default: () => <div data-testid="form-manager" />,
}));

vi.mock('../../components/SluExpert', () => ({
  default: () => <div data-testid="slu-expert" />,
}));

import ProjectWorkspace from '../../components/ProjectWorkspace';

const baseProps = {
  mode: 'LOGISTICS_MARKET' as const,
  activeTab: 'archive',
  onSetActiveTab: vi.fn(),
  onOpenMode: vi.fn(),
  onExitToDashboard: vi.fn(),
};

describe('ProjectWorkspace', () => {
  // ── WorkspaceScaffold is always rendered ──────────────────────────────────

  it('renders WorkspaceScaffold wrapper', async () => {
    render(<ProjectWorkspace {...baseProps} />);
    expect(await screen.findByTestId('workspace-scaffold')).toBeInTheDocument();
  });

  it('passes mode to WorkspaceScaffold', async () => {
    render(<ProjectWorkspace {...baseProps} />);
    const ws = await screen.findByTestId('workspace-scaffold');
    expect(ws).toHaveAttribute('data-mode', 'LOGISTICS_MARKET');
  });

  // ── LOGISTICS_MARKET tabs ─────────────────────────────────────────────────

  it('renders ExecutiveSummary for LOGISTICS_MARKET archive tab', async () => {
    render(<ProjectWorkspace {...baseProps} activeTab="archive" />);
    await waitFor(() => {
      expect(screen.getByTestId('executive-summary')).toBeInTheDocument();
    });
  });

  it('renders AssetTriage for LOGISTICS_MARKET triage tab', async () => {
    render(<ProjectWorkspace {...baseProps} activeTab="triage" />);
    expect(await screen.findByTestId('asset-triage')).toBeInTheDocument();
  });

  // ── Guide tab ─────────────────────────────────────────────────────────────

  it('renders guide loading fallback for guide activeTab', async () => {
    render(<ProjectWorkspace {...baseProps} activeTab="guide" />);
    expect(await screen.findByText('Laddar guide')).toBeInTheDocument();
  });

  // ── Legal tab ─────────────────────────────────────────────────────────────

  it('renders LegalSupportCenter for legal activeTab', async () => {
    render(<ProjectWorkspace {...baseProps} activeTab="legal" />);
    expect(await screen.findByTestId('legal-support-center')).toBeInTheDocument();
  });

  // ── PERMIT_PORTAL tabs ────────────────────────────────────────────────────

  it('renders PermitPortalView for PERMIT_PORTAL mode', async () => {
    render(<ProjectWorkspace {...baseProps} mode="PERMIT_PORTAL" activeTab="map" />);
    expect(await screen.findByTestId('permit-portal-map', {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  // ── COMPLIANCE_AUDIT tabs ─────────────────────────────────────────────────

  it('renders IntegrationsDashboard for COMPLIANCE_AUDIT default tab', async () => {
    render(<ProjectWorkspace {...baseProps} mode="COMPLIANCE_AUDIT" activeTab="other" />);
    expect(await screen.findByTestId('integrations-dashboard', {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  // ── Fallback for unknown mode ─────────────────────────────────────────────

  it('renders fallback for unknown mode', async () => {
    render(<ProjectWorkspace {...baseProps} mode={'UNKNOWN' as never} activeTab="other" />);
    expect(await screen.findByText(/Valj en sektion i menyn/i)).toBeInTheDocument();
  });
});
