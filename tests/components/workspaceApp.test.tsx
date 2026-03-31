import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Use vi.hoisted so the mock components are available inside the vi.mock() factory
const { MockPW, MockSW } = vi.hoisted(() => {
  const MockPW = ({ mode, activeTab }: { mode: string; activeTab: string }) => (
    <div data-testid="project-workspace" data-mode={mode} data-tab={activeTab} />
  );
  const MockSW = ({ mode, activeTab }: { mode: string; activeTab: string }) => (
    <div data-testid="standalone-workspace" data-mode={mode} data-tab={activeTab} />
  );
  return { MockPW, MockSW };
});

vi.mock('../../components/workspacePreload', () => ({
  loadProjectWorkspace: () => Promise.resolve({ default: MockPW }),
  loadStandaloneWorkspace: () => Promise.resolve({ default: MockSW }),
  needsProjectStructure: (mode: string, activeTab: string) => {
    if (activeTab === 'guide') return true;
    return ['LOGISTICS_MARKET', 'PERMIT_PORTAL', 'PROJECT_MANAGER', 'COMPLIANCE_AUDIT'].includes(mode);
  },
}));

import WorkspaceApp from '../../components/WorkspaceApp';

const baseProps = {
  onExitToDashboard: vi.fn(),
};

describe('WorkspaceApp', () => {
  // ── Project-aware modes ──────────────────────────────────────────────────

  it('renders ProjectWorkspace for LOGISTICS_MARKET', async () => {
    render(<WorkspaceApp {...baseProps} initialMode="LOGISTICS_MARKET" />);
    const pw = await screen.findByTestId('project-workspace');
    expect(pw).toHaveAttribute('data-mode', 'LOGISTICS_MARKET');
  });

  it('renders ProjectWorkspace for PERMIT_PORTAL', async () => {
    render(<WorkspaceApp {...baseProps} initialMode="PERMIT_PORTAL" />);
    expect(await screen.findByTestId('project-workspace')).toBeInTheDocument();
  });

  it('renders ProjectWorkspace for PROJECT_MANAGER', async () => {
    render(<WorkspaceApp {...baseProps} initialMode="PROJECT_MANAGER" />);
    expect(await screen.findByTestId('project-workspace')).toBeInTheDocument();
  });

  // ── Standalone modes ─────────────────────────────────────────────────────

  it('renders StandaloneWorkspace for MVP_WORKFLOW', async () => {
    render(<WorkspaceApp {...baseProps} initialMode="MVP_WORKFLOW" />);
    const sw = await screen.findByTestId('standalone-workspace');
    expect(sw).toHaveAttribute('data-mode', 'MVP_WORKFLOW');
  });

  it('renders StandaloneWorkspace for ADMIN_CONSOLE', async () => {
    render(<WorkspaceApp {...baseProps} initialMode="ADMIN_CONSOLE" />);
    expect(await screen.findByTestId('standalone-workspace')).toBeInTheDocument();
  });

  // ── Default tab ───────────────────────────────────────────────────────────

  it('passes default tab for LOGISTICS_MARKET (archive)', async () => {
    render(<WorkspaceApp {...baseProps} initialMode="LOGISTICS_MARKET" />);
    const pw = await screen.findByTestId('project-workspace');
    expect(pw).toHaveAttribute('data-tab', 'archive');
  });

  it('passes default tab for PERMIT_PORTAL (map)', async () => {
    render(<WorkspaceApp {...baseProps} initialMode="PERMIT_PORTAL" />);
    const pw = await screen.findByTestId('project-workspace');
    expect(pw).toHaveAttribute('data-tab', 'map');
  });
});
