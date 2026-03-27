import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/workspaceModes', () => ({
  resolveInterfaceModeFromModuleId: vi.fn((id: string) => {
    const map: Record<string, string> = {
      logistik: 'LOGISTICS_MARKET',
      ansokan: 'PERMIT_PORTAL',
      projekt: 'PROJECT_MANAGER',
    };
    return map[id] ?? null;
  }),
}));

vi.mock('../../components/workspacePreload', () => ({
  preloadWorkspaceForMode: vi.fn().mockResolvedValue(undefined),
  needsProjectStructure: vi.fn().mockReturnValue(false),
  loadProjectWorkspace: vi.fn(),
  loadStandaloneWorkspace: vi.fn(),
}));

vi.mock('../../components/TechnicalDashboardHub', () => ({
  TechnicalDashboardHub: ({ onSelectModule }: { onSelectModule: (id: string) => void }) => (
    <div data-testid="technical-dashboard">
      <button data-testid="select-logistik" onClick={() => onSelectModule('logistik')}>
        Logistik
      </button>
      <button data-testid="select-unknown" onClick={() => onSelectModule('unknown')}>
        Unknown
      </button>
    </div>
  ),
}));

vi.mock('../../components/WorkspaceApp', () => ({
  default: ({ initialMode }: { initialMode: string; onExitToDashboard: () => void }) => (
    <div data-testid="workspace-app" data-mode={initialMode} />
  ),
}));

import App from '../../components/App';

describe('App', () => {
  // ── Initial render ─────────────────────────────────────────────────────

  it('renders TechnicalDashboardHub initially', async () => {
    render(<App />);
    expect(await screen.findByTestId('technical-dashboard')).toBeInTheDocument();
  });

  it('does not render WorkspaceApp initially', async () => {
    render(<App />);
    await screen.findByTestId('technical-dashboard');
    expect(screen.queryByTestId('workspace-app')).not.toBeInTheDocument();
  });

  // ── Mode selection ─────────────────────────────────────────────────────

  it('renders WorkspaceApp after selecting a known module', async () => {
    render(<App />);
    fireEvent.click(await screen.findByTestId('select-logistik'));
    expect(await screen.findByTestId('workspace-app')).toBeInTheDocument();
  });

  it('passes resolved mode to WorkspaceApp', async () => {
    render(<App />);
    fireEvent.click(await screen.findByTestId('select-logistik'));
    const ws = await screen.findByTestId('workspace-app');
    expect(ws).toHaveAttribute('data-mode', 'LOGISTICS_MARKET');
  });

  it('does not switch mode for unknown module id', async () => {
    render(<App />);
    await screen.findByTestId('technical-dashboard');
    fireEvent.click(screen.getByTestId('select-unknown'));
    expect(screen.queryByTestId('workspace-app')).not.toBeInTheDocument();
    expect(screen.getByTestId('technical-dashboard')).toBeInTheDocument();
  });

  // ── Exit to dashboard ─────────────────────────────────────────────────

  it('renders WorkspaceApp with correct props after module selection', async () => {
    render(<App />);
    fireEvent.click(await screen.findByTestId('select-logistik'));
    expect(await screen.findByTestId('workspace-app')).toBeInTheDocument();
  });
});
