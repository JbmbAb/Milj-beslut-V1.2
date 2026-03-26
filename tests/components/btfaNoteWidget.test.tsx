import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BtfaNoteWidget } from '../../components/BtfaNoteWidget';

describe('BtfaNoteWidget', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    // localStorage mock
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Initial render / fetch notes ─────────────────────────────────────────

  it('renders heading', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    render(<BtfaNoteWidget caseId="case-1" />);
    expect(screen.getByText('BTFA.Anteckning')).toBeInTheDocument();
  });

  it('shows "Inga anteckningar" when API returns empty list', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    render(<BtfaNoteWidget caseId="case-1" />);
    await waitFor(() => expect(screen.getByText(/Inga anteckningar/i)).toBeInTheDocument());
  });

  it('renders existing notes from API', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '1', text: 'Test anteckning', author: 'Anna', timestamp: '2024-01-01T10:00:00Z' },
      ],
    });
    render(<BtfaNoteWidget caseId="case-1" />);
    await waitFor(() => expect(screen.getByText('Test anteckning')).toBeInTheDocument());
  });

  it('shows error when fetch fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'));
    render(<BtfaNoteWidget caseId="case-1" />);
    await waitFor(() => expect(screen.getByText(/Kunde inte ansluta/i)).toBeInTheDocument());
  });

  it('shows empty state for 404 response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => [],
    });
    render(<BtfaNoteWidget caseId="case-1" />);
    await waitFor(() => expect(screen.getByText(/Inga anteckningar/i)).toBeInTheDocument());
  });

  // ── Textarea/input ────────────────────────────────────────────────────────

  it('renders the text input', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] });
    render(<BtfaNoteWidget caseId="case-1" />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Skriv en tjänsteanteckning/i)).toBeInTheDocument()
    );
  });

  it('Spara button is disabled when input is empty', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] });
    render(<BtfaNoteWidget caseId="case-1" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Spara/i })).toBeDisabled()
    );
  });

  it('Spara button becomes enabled when typing', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] });
    render(<BtfaNoteWidget caseId="case-1" />);
    await waitFor(() => screen.getByPlaceholderText(/Skriv/i));
    await userEvent.type(screen.getByPlaceholderText(/Skriv/i), 'Ny anteckning');
    expect(screen.getByRole('button', { name: /Spara/i })).not.toBeDisabled();
  });

  it('shows optimistic note immediately after Spara click', async () => {
    // fetch: first for loading notes (empty), second for save
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '99', text: 'Ny not', author: 'Jag', timestamp: new Date().toISOString() }),
      });
    render(<BtfaNoteWidget caseId="case-1" />);
    await waitFor(() => screen.getByPlaceholderText(/Skriv/i));
    await userEvent.type(screen.getByPlaceholderText(/Skriv/i), 'Ny not');
    await userEvent.click(screen.getByRole('button', { name: /Spara/i }));
    // Optimistic update: note visible immediately
    expect(screen.getByText('Ny not')).toBeInTheDocument();
  });
});
