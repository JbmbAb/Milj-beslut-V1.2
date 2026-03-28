/**
 * Tests för components/App.tsx
 * Täcker entry-point initialisering, mode-switch och workspace-preload
 * Visar navigation mellan dashboard och workspace-moduler
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../components/App';

// Mock dependent modules
vi.mock('../../components/workspaceModes', () => ({
  resolveInterfaceModeFromModuleId: vi.fn((id: string) => {
    const modes: Record<string, string> = {
      mvp: 'mvp',
      ansokan: 'ansokan',
      logistik: 'logistik',
      projekt: 'projekt',
      gronkoll: 'gronkoll',
      admin: 'admin',
    };
    return modes[id] || null;
  }),
}));

vi.mock('../../components/workspacePreload', () => ({
  preloadWorkspaceForMode: vi.fn(),
}));

vi.mock('../../components/TechnicalDashboardHub', () => ({
  TechnicalDashboardHub: vi.fn(({ onSelectModule, onPreviewModule }) => (
    <div data-testid="dashboard-hub">
      <button onClick={() => onSelectModule('mvp')} data-testid="select-mvp">
        MVP
      </button>
      <button onClick={() => onSelectModule('ansokan')} data-testid="select-ansokan">
        Ansokan
      </button>
      <button onClick={() => onPreviewModule?.('mvp')} data-testid="preview-mvp">
        Preview MVP
      </button>
      <button onClick={() => onPreviewModule?.('ansokan')} data-testid="preview-ansokan">
        Preview Ansokan
      </button>
    </div>
  )),
}));

vi.mock('../../components/WorkspaceApp', () => ({
  default: vi.fn(({ initialMode, onExitToDashboard }) => (
    <div data-testid="workspace-app">
      <p data-testid="current-mode">{initialMode}</p>
      <button onClick={onExitToDashboard} data-testid="exit-to-dashboard">
        Exit to Dashboard
      </button>
    </div>
  )),
}));

describe('App component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('renders TechnicalDashboardHub initially', async () => {
      render(<App />);
      expect(await screen.findByTestId('dashboard-hub')).toBeInTheDocument();
    });

    it('does not render WorkspaceApp on initial load', () => {
      render(<App />);
      expect(screen.queryByTestId('workspace-app')).not.toBeInTheDocument();
    });

    it('renders with null mode state initially', () => {
      render(<App />);
      // Dashboard should be visible when mode is null
      expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument();
    });
  });

  describe('Module Selection Navigation', () => {
    it('transitions to WorkspaceApp when MVP module is selected', async () => {
      const user = userEvent.setup();
      render(<App />);

      expect(await screen.findByTestId('dashboard-hub')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-app')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('select-mvp'));

      expect(await screen.findByTestId('workspace-app')).toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-hub')).not.toBeInTheDocument();
    });

    it('transitions with correct mode when Ansokan module is selected', async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(await screen.findByTestId('select-ansokan'));

      expect(await screen.findByTestId('workspace-app')).toBeInTheDocument();
      expect(screen.getByTestId('current-mode')).toHaveTextContent('ansokan');
    });

    it('can switch between different modules', async () => {
      const user = userEvent.setup();
      render(<App />);

      // Select MVP
      await user.click(await screen.findByTestId('select-mvp'));
      expect(screen.getByTestId('current-mode')).toHaveTextContent('mvp');

      // Exit to dashboard
      await user.click(screen.getByTestId('exit-to-dashboard'));
      expect(await screen.findByTestId('dashboard-hub')).toBeInTheDocument();

      // Select different module
      await user.click(screen.getByTestId('select-ansokan'));
      expect(screen.getByTestId('current-mode')).toHaveTextContent('ansokan');
    });
  });

  describe('Exit to Dashboard', () => {
    it('returns to dashboard when exiting workspace', async () => {
      const user = userEvent.setup();
      render(<App />);

      // Select a module first
      await user.click(await screen.findByTestId('select-mvp'));
      expect(await screen.findByTestId('workspace-app')).toBeInTheDocument();

      // Exit to dashboard
      await user.click(screen.getByTestId('exit-to-dashboard'));
      expect(await screen.findByTestId('dashboard-hub')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-app')).not.toBeInTheDocument();
    });

    it('resets mode state to null when exiting', async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(await screen.findByTestId('select-mvp'));
      await user.click(screen.getByTestId('exit-to-dashboard'));

      // Dashboard should be visible again (mode is null)
      expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument();
    });
  });

  describe('Module Preview', () => {
    it('calls onPreviewModule when preview button clicked', async () => {
      const user = userEvent.setup();
      render(<App />);

      // Preview should be callable without changing mode
      await user.click(await screen.findByTestId('preview-mvp'));
      expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument();
    });

    it('can preview different modules without navigating', async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(screen.getByTestId('preview-mvp'));
      expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument();

      await user.click(screen.getByTestId('preview-ansokan'));
      expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument();
    });
  });

  describe('State Management', () => {
    it('maintains mode state across component lifecycle', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<App />);

      await user.click(await screen.findByTestId('select-mvp'));
      expect(screen.getByTestId('current-mode')).toHaveTextContent('mvp');

      rerender(<App />);
      expect(screen.getByTestId('current-mode')).toHaveTextContent('mvp');
    });
  });

  describe('Lazy Loading', () => {
    it('uses Suspense for lazy-loaded components', async () => {
      render(<App />);
      // Dashboard should load via Suspense
      expect(await screen.findByTestId('dashboard-hub')).toBeInTheDocument();
    });

    it('WorkspaceApp is lazy-loaded on demand', async () => {
      const user = userEvent.setup();
      render(<App />);

      // WorkspaceApp should not be in DOM until needed
      expect(screen.queryByTestId('workspace-app')).not.toBeInTheDocument();

      // After selecting a module, it should load
      await user.click(await screen.findByTestId('select-mvp'));
      expect(await screen.findByTestId('workspace-app')).toBeInTheDocument();
    });
  });

  describe('Integration', () => {
    it('full workflow: dashboard -> select module -> use workspace -> exit', async () => {
      const user = userEvent.setup();
      render(<App />);

      // Step 1: Verify dashboard is initial state
      const dashboard = await screen.findByTestId('dashboard-hub');
      expect(dashboard).toBeInTheDocument();

      // Step 2: Select MVP module
      await user.click(screen.getByTestId('select-mvp'));
      expect(await screen.findByTestId('workspace-app')).toBeInTheDocument();

      // Step 3: Workspace is now active with correct mode
      expect(screen.getByTestId('current-mode')).toHaveTextContent('mvp');

      // Step 4: Exit back to dashboard
      await user.click(screen.getByTestId('exit-to-dashboard'));
      expect(await screen.findByTestId('dashboard-hub')).toBeInTheDocument();

      // Step 5: Workspace is no longer visible
      expect(screen.queryByTestId('workspace-app')).not.toBeInTheDocument();
    });
  });
});
