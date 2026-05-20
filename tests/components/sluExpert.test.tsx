import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SluExpert from '../../components/SluExpert';

const projectId = 'proj-1';

describe('SluExpert', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // ── Initial render ──────────────────────────────────────────────────────────

  it('renders the component heading', () => {
    render(<SluExpert projectId={projectId} />);
    expect(screen.getByText(/SLU Artdatabanken Scan/i)).toBeInTheDocument();
  });

  it('shows the Artportalen live badge', () => {
    render(<SluExpert projectId={projectId} />);
    expect(screen.getByText(/Kräver verifierad SLU-källa/i)).toBeInTheDocument();
  });

  it('renders the "Starta Inventering" button initially', () => {
    render(<SluExpert projectId={projectId} />);
    expect(screen.getByRole('button', { name: /Starta Inventering/i })).toBeInTheDocument();
  });

  // ── Loading state ───────────────────────────────────────────────────────────

  it('shows loading spinner when analysis is running', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as any);
    render(<SluExpert projectId={projectId} />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    expect(screen.getByText(/Söker i Artportalen/i)).toBeInTheDocument();
  });

  it('hides the button while loading', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as any);
    render(<SluExpert projectId={projectId} />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    expect(screen.queryByRole('button', { name: /Starta Inventering/i })).not.toBeInTheDocument();
  });

  // ── Success state ───────────────────────────────────────────────────────────

  it('shows AI summary on successful scan', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: { summary: 'Inga fridlysta arter funna vid fastigheten.', observations: [] },
      }),
    } as any);
    render(<SluExpert projectId={projectId} />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() =>
      expect(screen.getByText('Inga fridlysta arter funna vid fastigheten.')).toBeInTheDocument(),
    );
  });

  it('renders observation cards', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          summary: 'Fynd noterade.',
          observations: [
            { name: 'Åkergroda', status: 'Fridlyst', distance: 150 },
            { name: 'Tallticka', status: 'Rödlistad', distance: 340 },
          ],
        },
      }),
    } as any);
    render(<SluExpert projectId={projectId} />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() => expect(screen.getByText('Åkergroda')).toBeInTheDocument());
    expect(screen.getByText('Tallticka')).toBeInTheDocument();
  });

  it('shows Fridlyst badge on fridlyst observation', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: { summary: '', observations: [{ name: 'Paddoxe', status: 'Fridlyst', distance: 200 }] },
      }),
    } as any);
    render(<SluExpert projectId={projectId} />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() => expect(screen.getByText('Fridlyst')).toBeInTheDocument());
  });

  it('shows Rödlistad badge on rodlistad observation', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: { summary: '', observations: [{ name: 'Flygekorren', status: 'Rödlistad', distance: 500 }] },
      }),
    } as any);
    render(<SluExpert projectId={projectId} />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() => expect(screen.getByText('Rödlistad')).toBeInTheDocument());
  });

  // ── Offline/error fallback ─────────────────────────────────────────────────

  it('shows offline fallback summary when analysis throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('API unavailable'));
    render(<SluExpert projectId={projectId} />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() => expect(screen.getByText(/API unavailable/)).toBeInTheDocument());
  });

  it('shows error state when analysis throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('timeout'));
    render(<SluExpert projectId={projectId} />);
    await userEvent.click(screen.getByRole('button', { name: /Starta Inventering/i }));
    await waitFor(() => expect(screen.getByText(/timeout/)).toBeInTheDocument());
  });
});
