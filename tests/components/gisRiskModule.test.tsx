import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/MapView', () => ({
  default: () => <div data-testid="map-view" />,
}));

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: () => ({
    evaluateGate: vi.fn().mockResolvedValue({ status: 'PASSED', changed: false }),
    addArchiveDocument: vi.fn(),
    markModuleReady: vi.fn(),
  }),
}));

import GisRiskModule from '../../components/GisRiskModule';

const user = userEvent.setup({ delay: null });

describe('GisRiskModule', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial render ────────────────────────────────────────────────────────

  it('renders the Risk-konfigurator heading', () => {
    render(<GisRiskModule />);
    expect(screen.getByText(/Risk-konfigurator/i)).toBeInTheDocument();
  });

  it('renders the Spatial parametrisering subtitle', () => {
    render(<GisRiskModule />);
    expect(screen.getByText(/Spatial parametrisering/i)).toBeInTheDocument();
  });

  it('renders file upload input', () => {
    render(<GisRiskModule />);
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();
  });

  it('renders the buffer zone range input', () => {
    render(<GisRiskModule />);
    const rangeInput = document.querySelector('input[type="range"]');
    expect(rangeInput).toBeInTheDocument();
  });

  it('renders sensitivity level buttons Low/Medium/High', () => {
    render(<GisRiskModule />);
    expect(screen.getByRole('button', { name: 'Low' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Medium' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'High' })).toBeInTheDocument();
  });

  it('renders the analyse button disabled when no file loaded', () => {
    render(<GisRiskModule />);
    const analyseBtn = screen.getByRole('button', { name: /Starta Analys/i });
    expect(analyseBtn).toBeDisabled();
  });

  it('renders the Buffertzon label', () => {
    render(<GisRiskModule />);
    expect(screen.getByText(/Buffertzon/i)).toBeInTheDocument();
  });

  it('renders flood risk toggle', () => {
    render(<GisRiskModule />);
    expect(screen.getByText(/Inkludera oversvamning/i)).toBeInTheDocument();
  });

  it('shows initial buffer distance of 100m', () => {
    render(<GisRiskModule />);
    expect(screen.getByText('100m')).toBeInTheDocument();
  });

  it('changes sensitivity level when button clicked', async () => {
    render(<GisRiskModule />);
    const highBtn = screen.getByRole('button', { name: 'High' });
    await user.click(highBtn);
    expect(highBtn).toHaveClass('bg-slate-900');
  });
});
