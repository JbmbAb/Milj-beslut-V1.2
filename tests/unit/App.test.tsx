import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import App from '../../components/App';
import { ProjectStructureProvider } from '../../components/ProjectStructureContext';

vi.mock('../../services/coreApiClient', () => ({
  callApi: vi.fn(async () => ({ ok: true })),
  clearSession: vi.fn(),
  getActiveProjectId: vi.fn(() => 'proj-1'),
  getToken: vi.fn(() => 'test-token'),
  refreshAccessSession: vi.fn(),
  setActiveProjectId: vi.fn(),
}));

vi.mock('@miljobeslut/mps-console', () => ({
  uiConfig: { enableLegacyUi: false },
  MpsConsoleApp: () => <div data-testid="mps-console-app">Mimer Console Dashboard</div>,
}));

describe('App component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders MpsConsoleApp via AppShell', async () => {
    render(
      <ProjectStructureProvider>
        <App />
      </ProjectStructureProvider>
    );
    expect(await screen.findByText(/Mimer Console/i)).toBeInTheDocument();
    expect(await screen.findByText(/Dashboard/i)).toBeInTheDocument();
  });
});
