import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarketingHub from '../../components/MarketingHub';
import { DecisionType, type Permit } from '../../types';

vi.mock('../../services/geminiService', () => ({
  generateMarketingSummary: vi.fn(),
  analyzeBiodiversity: vi.fn(),
}));

import { generateMarketingSummary } from '../../services/geminiService';

const genMock = generateMarketingSummary as ReturnType<typeof vi.fn>;

const basePermits: Permit[] = [
  {
    id: 1,
    filename: 'test.pdf',
    checksum: 'abc123',
    received_date: '2024-01-01',
    property_id: 'prop-1',
    municipality: 'Stockholm',
    waste_codes: '19 12 12',
    decision_type: DecisionType.BIFALL,
    full_text: 'Test permit text',
    processed_at: '2024-01-02',
  },
];

describe('MarketingHub', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial / idle state ────────────────────────────────────────────────────

  it('renders the "Generera Affärsinsikt" heading initially', () => {
    render(<MarketingHub permits={basePermits} />);
    expect(screen.getByText('Generera Affärsinsikt')).toBeInTheDocument();
  });

  it('renders the "Kör Trend-motor" button initially', () => {
    render(<MarketingHub permits={basePermits} />);
    expect(screen.getByRole('button', { name: /Kör Trend-motor/i })).toBeInTheDocument();
  });

  // ── Loading state ───────────────────────────────────────────────────────────

  it('shows loading spinner when analysis is running', async () => {
    const user = userEvent.setup({ delay: null });
    genMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<MarketingHub permits={basePermits} />);
    await user.click(screen.getByRole('button', { name: /Kör Trend-motor/i }));
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('hides "Kör Trend-motor" while loading', async () => {
    const user = userEvent.setup({ delay: null });
    genMock.mockReturnValue(new Promise(() => {}));
    render(<MarketingHub permits={basePermits} />);
    await user.click(screen.getByRole('button', { name: /Kör Trend-motor/i }));
    expect(screen.queryByRole('button', { name: /Kör Trend-motor/i })).not.toBeInTheDocument();
  });

  // ── Success state ───────────────────────────────────────────────────────────

  it('shows marketing summary text on success', async () => {
    const user = userEvent.setup({ delay: null });
    genMock.mockResolvedValue({ text: 'Starkt intresse i norrland', sources: [] });
    render(<MarketingHub permits={basePermits} />);
    await user.click(screen.getByRole('button', { name: /Kör Trend-motor/i }));
    await waitFor(() => expect(screen.getByText('Starkt intresse i norrland')).toBeInTheDocument());
  });

  it('shows "Marknadsrapport" heading after analysis', async () => {
    const user = userEvent.setup({ delay: null });
    genMock.mockResolvedValue({ text: 'Analys klar.', sources: [] });
    render(<MarketingHub permits={basePermits} />);
    await user.click(screen.getByRole('button', { name: /Kör Trend-motor/i }));
    await waitFor(() => expect(screen.getByText(/Marknadsrapport/i)).toBeInTheDocument());
  });

  it('clicking reset button returns to initial state', async () => {
    const user = userEvent.setup({ delay: null });
    genMock.mockResolvedValue({ text: 'Analys klar.', sources: [] });
    render(<MarketingHub permits={basePermits} />);
    await user.click(screen.getByRole('button', { name: /Kör Trend-motor/i }));
    await waitFor(() => screen.getByText(/Marknadsrapport/i));
    // Click reset (fa-rotate-left button)
    const buttons = screen.getAllByRole('button');
    const resetBtn = buttons.find((b) => !b.textContent?.includes('Kör'));
    if (resetBtn) await user.click(resetBtn);
    expect(screen.getByRole('button', { name: /Kör Trend-motor/i })).toBeInTheDocument();
  });

  // ── Error/offline fallback ─────────────────────────────────────────────────

  it('shows offline fallback text when analysis throws', async () => {
    const user = userEvent.setup({ delay: null });
    genMock.mockRejectedValue(new Error('API down'));
    render(<MarketingHub permits={basePermits} />);
    await user.click(screen.getByRole('button', { name: /Kör Trend-motor/i }));
    await waitFor(() => expect(screen.getByText(/Offline-lage/i)).toBeInTheDocument());
  });
});
