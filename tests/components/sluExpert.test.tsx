import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SluExpert from '../../components/SluExpert';

vi.mock('../../services/geminiService', () => ({
  analyzeBiodiversity: vi.fn(),
}));

import { analyzeBiodiversity } from '../../services/geminiService';

const analyzesMock = analyzeBiodiversity as ReturnType<typeof vi.fn>;

describe('SluExpert', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial render ──────────────────────────────────────────────────────────

  it('renders the component heading', () => {
    render(<SluExpert />);
    expect(screen.getByText(/SLU Artdatabanken Scan/i)).toBeInTheDocument();
  });

  it('shows the Artportalen live badge', () => {
    render(<SluExpert />);
    expect(screen.getByText(/Artportalen/i)).toBeInTheDocument();
  });

  it('renders the "Starta Inventering" button initially', () => {
    render(<SluExpert />);
    expect(screen.getByRole('button', { name: /Starta Inventering/i })).toBeInTheDocument();
  });

  // ── Loading state ───────────────────────────────────────────────────────────

  it('shows loading spinner when analysis is running', async () => {
    analyzesMock.mockReturnValue(new Promise(() => {}));
    render(<SluExpert />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    expect(screen.getByText(/Söker i Artportalen/i)).toBeInTheDocument();
  });

  it('hides the button while loading', async () => {
    analyzesMock.mockReturnValue(new Promise(() => {}));
    render(<SluExpert />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    expect(screen.queryByRole('button', { name: /Starta Inventering/i })).not.toBeInTheDocument();
  });

  // ── Success state ───────────────────────────────────────────────────────────

  it('shows AI summary on successful scan', async () => {
    analyzesMock.mockResolvedValue({
      summary: 'Inga fridlysta arter funna vid fastigheten.',
      observations: [],
    });
    render(<SluExpert />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() =>
      expect(screen.getByText('Inga fridlysta arter funna vid fastigheten.')).toBeInTheDocument(),
    );
  });

  it('renders observation cards', async () => {
    analyzesMock.mockResolvedValue({
      summary: 'Fynd noterade.',
      observations: [
        { name: 'Åkergroda', status: 'Fridlyst', distance: 150 },
        { name: 'Tallticka', status: 'Rödlistad', distance: 340 },
      ],
    });
    render(<SluExpert />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() => expect(screen.getByText('Åkergroda')).toBeInTheDocument());
    expect(screen.getByText('Tallticka')).toBeInTheDocument();
  });

  it('shows Fridlyst badge on fridlyst observation', async () => {
    analyzesMock.mockResolvedValue({
      summary: '',
      observations: [{ name: 'Paddoxe', status: 'Fridlyst', distance: 200 }],
    });
    render(<SluExpert />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() => expect(screen.getByText('Fridlyst')).toBeInTheDocument());
  });

  it('shows Rödlistad badge on rodlistad observation', async () => {
    analyzesMock.mockResolvedValue({
      summary: '',
      observations: [{ name: 'Flygekorren', status: 'Rödlistad', distance: 500 }],
    });
    render(<SluExpert />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() => expect(screen.getByText('Rödlistad')).toBeInTheDocument());
  });

  // ── Offline/error fallback ─────────────────────────────────────────────────

  it('shows offline fallback summary when analysis throws', async () => {
    analyzesMock.mockRejectedValue(new Error('API unavailable'));
    render(<SluExpert />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() => expect(screen.getByText(/Offline-lage/)).toBeInTheDocument());
  });

  it('shows offline fallback observations when analysis throws', async () => {
    analyzesMock.mockRejectedValue(new Error('timeout'));
    render(<SluExpert />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() => expect(screen.getByText('Akergroda')).toBeInTheDocument());
    expect(screen.getByText('Tallticka')).toBeInTheDocument();
  });
});
