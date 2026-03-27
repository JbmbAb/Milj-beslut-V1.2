import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// framer-motion mock (different package from motion/react used in BankIDLogin)
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../services/geminiService', () => ({
  analyzeBiodiversity: vi.fn(),
  generateMarketingSummary: vi.fn(),
  classifyAsset: vi.fn(),
}));

import { TechnicalSluExpert } from '../../components/TechnicalSluExpert';
import { analyzeBiodiversity } from '../../services/geminiService';

const analyzesMock = analyzeBiodiversity as ReturnType<typeof vi.fn>;

const user = userEvent.setup({ delay: null });

describe('TechnicalSluExpert', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial render ──────────────────────────────────────────────────────────

  it('renders the heading', () => {
    render(<TechnicalSluExpert />);
    expect(screen.getByText('SLU Artdatabanken Scan')).toBeInTheDocument();
  });

  it('renders lat/lng input fields with default values', () => {
    render(<TechnicalSluExpert />);
    expect(screen.getByPlaceholderText('Lat')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Lng')).toBeInTheDocument();
  });

  it('renders the start button', () => {
    render(<TechnicalSluExpert />);
    expect(screen.getByRole('button', { name: /Starta Scan/i })).toBeInTheDocument();
  });

  // ── Loading state ───────────────────────────────────────────────────────────

  it('shows loading indicator when scanning', async () => {
    analyzesMock.mockReturnValue(new Promise(() => {}));
    render(<TechnicalSluExpert />);
    await user.click(screen.getByRole('button', { name: /Starta Scan/i }));
    await waitFor(() => expect(screen.getByText(/Analyserar/i)).toBeInTheDocument());
  });

  // ── Success state ───────────────────────────────────────────────────────────

  it('shows AI summary after successful scan', async () => {
    analyzesMock.mockResolvedValue({
      summary: 'Inga hotade arter funna.',
      observations: [],
      protectedAreas: [],
    });
    render(<TechnicalSluExpert />);
    await user.click(screen.getByRole('button', { name: /Starta Scan/i }));
    await waitFor(() => expect(screen.getByText('Inga hotade arter funna.')).toBeInTheDocument());
  });

  it('renders observation cards from API response', async () => {
    analyzesMock.mockResolvedValue({
      summary: 'Fynd.',
      observations: [
        { name: 'Flygekorren', status: 'Rödlistad', distance: 200 },
      ],
      protectedAreas: [],
    });
    render(<TechnicalSluExpert />);
    await user.click(screen.getByRole('button', { name: /Starta Scan/i }));
    await waitFor(() => expect(screen.getByText('Flygekorren')).toBeInTheDocument());
  });

  // ── Offline fallback ────────────────────────────────────────────────────────

  it('shows offline fallback on error', async () => {
    analyzesMock.mockRejectedValue(new Error('network error'));
    render(<TechnicalSluExpert />);
    await user.click(screen.getByRole('button', { name: /Starta Scan/i }));
    await waitFor(() => expect(screen.getByText(/Offline-läge/i)).toBeInTheDocument());
  });
});
