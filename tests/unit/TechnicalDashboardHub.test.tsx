import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TechnicalDashboardHub } from '../../components/TechnicalDashboardHub';
import React from 'react';

// Robust Observer Mock
class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  callback: IntersectionObserverCallback;
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}
global.IntersectionObserver = MockIntersectionObserver as any;

// Lazy module mock
vi.mock('../../components/TechnicalSluExpert', () => ({
  TechnicalSluExpert: () => <div data-testid="expert-view">Expert</div>,
}));

describe('TechnicalDashboardHub', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('Header & Branding', () => {
    it('renders the header with RiskGuard logo', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      const logo = screen.getByText(/RiskGuard/);
      expect(logo).toBeInTheDocument();
    });

    it('displays product tagline "Miljobeslut 2.0"', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.getByText(/Miljobeslut 2.0/)).toBeInTheDocument();
    });

    it('renders search bar placeholder text', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      const searchInput = screen.getByPlaceholderText(/Sok i kunskapsgraf/);
      expect(searchInput).toBeInTheDocument();
    });

    it('displays user avatar icon in header', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      const userButton = screen.getByRole('button', { hidden: true });
      expect(userButton).toBeInTheDocument();
    });
  });

  describe('Main Content & Hero Section', () => {
    it('displays the main tagline', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.getByText(/Gor miljo-tillstand enkelt och sakert/i)).toBeInTheDocument();
    });

    it('displays description about data sources', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.getByText(/Systematiserad handlaggning/)).toBeInTheDocument();
    });

    it('displays Gemini 1.5 Pro powered badge', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.getByText(/Powered by Gemini 1.5 Pro/)).toBeInTheDocument();
    });
  });

  describe('Module Cards', () => {
    it('renders all six module cards', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.getByTestId('landing-open-mvp')).toBeInTheDocument();
      expect(screen.getByTestId('landing-open-ansokan')).toBeInTheDocument();
      expect(screen.getByTestId('landing-open-logistik')).toBeInTheDocument();
      expect(screen.getByTestId('landing-open-projekt')).toBeInTheDocument();
      expect(screen.getByTestId('landing-open-gronkoll')).toBeInTheDocument();
      expect(screen.getByTestId('landing-open-admin')).toBeInTheDocument();
    });

    it('displays correct module titles', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.getByText('MVP Workflow')).toBeInTheDocument();
      expect(screen.getByText('Ansokningsportal')).toBeInTheDocument();
      expect(screen.getByText('Logistik & Massor')).toBeInTheDocument();
      expect(screen.getByText('Projektledning')).toBeInTheDocument();
      expect(screen.getByText('Gronkoll (Score)')).toBeInTheDocument();
      expect(screen.getByText('Administrator')).toBeInTheDocument();
    });

    it('displays module descriptions', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.getByText(/Snabbspar for klassificering/)).toBeInTheDocument();
      expect(screen.getByText(/Automatiserade forhandsprovningar/)).toBeInTheDocument();
    });

    it('displays module badges (NEW, AI-SUPPORT, etc)', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.getByText('NEW')).toBeInTheDocument();
      expect(screen.getByText('AI-SUPPORT')).toBeInTheDocument();
      expect(screen.getByText('GEOSPATIAL')).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('triggers onSelectModule callback with correct module id when MVP card clicked', async () => {
      const selectSpy = vi.fn();
      const user = userEvent.setup();
      render(<TechnicalDashboardHub onSelectModule={selectSpy} />);

      await user.click(screen.getByTestId('landing-open-mvp'));
      expect(selectSpy).toHaveBeenCalledWith('mvp');
    });

    it('triggers onSelectModule for each module card', async () => {
      const selectSpy = vi.fn();
      const user = userEvent.setup();
      render(<TechnicalDashboardHub onSelectModule={selectSpy} />);

      const moduleIds = ['mvp', 'ansokan', 'logistik', 'projekt', 'gronkoll', 'admin'];
      for (const moduleId of moduleIds) {
        selectSpy.mockClear();
        await user.click(screen.getByTestId(`landing-open-${moduleId}`));
        expect(selectSpy).toHaveBeenCalledWith(moduleId);
      }
    });

    it('calls onPreviewModule when hovering over a card', async () => {
      const previewSpy = vi.fn();
      const user = userEvent.setup();
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} onPreviewModule={previewSpy} />);

      const mvpCard = screen.getByTestId('landing-open-mvp');
      await user.hover(mvpCard);
      expect(previewSpy).toHaveBeenCalledWith('mvp');
    });

    it('calls onPreviewModule on focus', async () => {
      const previewSpy = vi.fn();
      const user = userEvent.setup();
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} onPreviewModule={previewSpy} />);

      const mvpCard = screen.getByTestId('landing-open-mvp');
      await user.tab();
      await waitFor(() => {
        expect(mvpCard).toHaveFocus();
      });
      expect(previewSpy).toHaveBeenCalledWith('mvp');
    });
  });

  describe('Expert Section & Lazy Loading', () => {
    it('renders expert section placeholder initially', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.getByText(/Expertvy laddas nar sektionen narmar sig/)).toBeInTheDocument();
    });

    it('does not render expert component initially (lazy loaded)', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.queryByTestId('expert-view')).not.toBeInTheDocument();
    });
  });

  describe('Data Integrity', () => {
    it('ensures no legacy mock data is visible', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      expect(screen.queryByText('System User')).not.toBeInTheDocument();
      expect(screen.queryByText('1 045')).not.toBeInTheDocument();
      expect(screen.queryByText('MOCK')).not.toBeInTheDocument();
    });

    it('does not hardcode statistics or user context', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      // Ensure no fake data like "5 projects", "100+ documents", etc.
      expect(screen.queryByText(/^\d+ (projects|documents|cases)/)).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('module cards have accessible test identifiers', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      const mvpCard = screen.getByTestId('landing-open-mvp');
      expect(mvpCard).toHaveAttribute('data-testid');
    });

    it('renders semantic headings', () => {
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      const headings = screen.getAllByRole('heading');
      expect(headings.length).toBeGreaterThan(0);
    });

    it('cards are keyboard focusable', async () => {
      const user = userEvent.setup();
      render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      const mvpCard = screen.getByTestId('landing-open-mvp');

      await user.tab();
      await waitFor(() => {
        expect(mvpCard).toHaveFocus();
      });
    });
  });

  describe('Responsiveness & Layout', () => {
    it('renders in a grid layout', () => {
      const { container } = render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      const gridContainer = container.querySelector('.grid');
      expect(gridContainer).toBeInTheDocument();
    });

    it('applies responsive grid classes', () => {
      const { container } = render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
      const gridContainer = container.querySelector('.grid');
      expect(gridContainer).toHaveClass('gap-6');
      expect(gridContainer).toHaveClass('md:grid-cols-2');
      expect(gridContainer).toHaveClass('lg:grid-cols-4');
    });
  });
});
