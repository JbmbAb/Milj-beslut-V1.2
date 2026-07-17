import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/workspacePreload', () => ({
  preloadWorkspaceForMode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../components/ChatBot', () => ({
  default: () => <div data-testid="chatbot" />,
}));

vi.mock('../../components/LegalSupportCenter', () => ({
  default: () => <div data-testid="legal-support" />,
}));

vi.mock('../../components/CoreWorkflowView', () => ({
  default: () => <div data-testid="core-workflow-view" />,
  CoreWorkflowView: () => <div data-testid="core-workflow-view" />,
}));

vi.mock('../../components/AdminMetadataReview', () => ({
  default: () => <div data-testid="admin-metadata-review" />,
}));

vi.mock('../../components/AdminSearchConsole', () => ({
  default: ({ panel }: { panel: string }) => <div data-testid={`admin-search-${panel}`} />,
}));

import StandaloneWorkspace from '../../components/StandaloneWorkspace';

const baseProps = {
  activeTab: 'summary',
  onSetActiveTab: vi.fn(),
  onOpenMode: vi.fn(),
  onExitToDashboard: vi.fn(),
};

describe('StandaloneWorkspace', () => {
  // ── Core_WORKFLOW mode ─────────────────────────────────────────────────────

  it('renders CoreWorkflowView for Core_WORKFLOW mode', async () => {
    render(<StandaloneWorkspace {...baseProps} mode="Core_WORKFLOW" />);
    expect(await screen.findByTestId('core-workflow-view')).toBeInTheDocument();
  });

  // ── ADMIN_CONSOLE mode ────────────────────────────────────────────────────

  it('renders AdminMetadataReview by default for ADMIN_CONSOLE', async () => {
    render(<StandaloneWorkspace {...baseProps} mode="ADMIN_CONSOLE" />);
    expect(await screen.findByTestId('admin-metadata-review')).toBeInTheDocument();
  });

  it('renders AdminSearchConsole search panel for admin-search tab', async () => {
    render(<StandaloneWorkspace {...baseProps} mode="ADMIN_CONSOLE" activeTab="admin-search" />);
    expect(await screen.findByTestId('admin-search-search')).toBeInTheDocument();
  });

  it('renders AdminSearchConsole insight panel for admin-insight tab', async () => {
    render(<StandaloneWorkspace {...baseProps} mode="ADMIN_CONSOLE" activeTab="admin-insight" />);
    expect(await screen.findByTestId('admin-search-insight')).toBeInTheDocument();
  });

  it('renders LegalSupportCenter when activeTab is legal', async () => {
    render(<StandaloneWorkspace {...baseProps} mode="Core_WORKFLOW" activeTab="legal" />);
    expect(await screen.findByTestId('legal-support')).toBeInTheDocument();
  });

  // ── Unknown mode ──────────────────────────────────────────────────────────

  it('renders fallback message for unknown mode', async () => {
    render(<StandaloneWorkspace {...baseProps} mode={'UNKNOWN' as never} />);
    expect(await screen.findByText(/Valj en sektion i menyn/i)).toBeInTheDocument();
  });

  // ── ADMIN badge ───────────────────────────────────────────────────────────

  it('shows ADMIN SESSION badge for ADMIN_CONSOLE mode', async () => {
    render(<StandaloneWorkspace {...baseProps} mode="ADMIN_CONSOLE" />);
    expect(await screen.findByText('ADMIN SESSION')).toBeInTheDocument();
  });
});
