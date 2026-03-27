import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IntegrationsDashboard from '../../components/IntegrationsDashboard';

const successPayload = {
  ok: true,
  summary: {
    cards: [
      {
        id: 'nvr',
        name: 'Skyddad natur',
        provider: 'Naturvardsverket',
        dataType: 'API',
        status: 'CONNECTED',
        lastSync: '2024-01-01T00:00:00Z',
        complexity: 3,
        reason: 'OK',
        activation: 'IMMEDIATE',
        latencyMs: 120,
      },
      {
        id: 'sgu',
        name: 'SGU risklager',
        provider: 'SGU',
        dataType: 'PostGIS',
        status: 'DISCONNECTED',
        lastSync: 'Fallback',
        complexity: 4,
        reason: 'Saknar tillstånd',
        activation: 'PERMIT_REQUIRED',
      },
    ],
    dispatch: {
      requestedProvider: 'MOCK_FRAKTBORS',
      activeProvider: 'MOCK_FRAKTBORS',
      fallbackActive: false,
      credentials: { timocomConfigured: false, transEuConfigured: false },
    },
    checkedAt: '2024-01-01T00:00:00Z',
  },
};

describe('IntegrationsDashboard', () => {
  beforeEach(() => {
    vi.stubGlobal('setInterval', vi.fn().mockReturnValue(999));
    vi.stubGlobal('clearInterval', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Loading / initial state ─────────────────────────────────────────────────

  it('renders the main heading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<IntegrationsDashboard />);
    expect(screen.getByText(/Systemarkitektur och API/i)).toBeInTheDocument();
  });

  // ── Success state ───────────────────────────────────────────────────────────

  it('shows integration cards from API response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => successPayload }));
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText('Skyddad natur')).toBeInTheDocument());
    expect(screen.getByText('SGU risklager')).toBeInTheDocument();
  });

  it('shows CONNECTED badge', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => successPayload }));
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText('Aktiv')).toBeInTheDocument());
  });

  it('shows DISCONNECTED badge', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => successPayload }));
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText('Krav saknas')).toBeInTheDocument());
  });

  it('shows success info message after load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => successPayload }));
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText(/Publik integrationssammanstallning/)).toBeInTheDocument());
  });

  // ── Fallback/error state ────────────────────────────────────────────────────

  it('shows fallback cards when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText('Skyddad natur')).toBeInTheDocument());
  });

  it('shows error info when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText(/Fallbackvy aktiv/)).toBeInTheDocument());
  });

  it('shows fallback cards when API returns !ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ ok: false, error: 'Service unavailable' }),
      }),
    );
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText('Skyddad natur')).toBeInTheDocument());
  });

  // ── Uppdatera button ────────────────────────────────────────────────────────

  it('has an "Uppdatera" button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => successPayload }));
    render(<IntegrationsDashboard />);
    await waitFor(() => screen.getByText('Skyddad natur'));
    expect(screen.getByRole('button', { name: /Uppdatera/i })).toBeInTheDocument();
  });
});
