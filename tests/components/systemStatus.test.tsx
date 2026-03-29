import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemStatus } from '../../components/SystemStatus';

describe('SystemStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  it('shows loading skeleton initially', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { container } = render(<SystemStatus />);
    // animate-pulse class indicates loading skeleton
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  // ── Success (ok: true) ────────────────────────────────────────────────────

  it('shows ONLINE status when API returns ok=true', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: 'PostGIS aktiv', version: 'pg 14.5' }),
    });
    render(<SystemStatus />);
    await waitFor(() => expect(screen.getByText('ONLINE')).toBeInTheDocument());
  });

  it('shows message when ok=true', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: 'Allt fungerar', version: null }),
    });
    render(<SystemStatus />);
    await waitFor(() => expect(screen.getByText('Allt fungerar')).toBeInTheDocument());
  });

  it('shows version string when returned', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: 'OK', version: 'PostgreSQL 14.5 PostGIS 3.2' }),
    });
    render(<SystemStatus />);
    await waitFor(() => expect(screen.getByText('PostgreSQL 14.5 PostGIS 3.2')).toBeInTheDocument());
  });

  it('does not show version block when version is absent', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: 'OK' }),
    });
    render(<SystemStatus />);
    await waitFor(() => expect(screen.getByText('ONLINE')).toBeInTheDocument());
    // Should not render any version code block
    const codes = document.querySelectorAll('code');
    expect(codes.length).toBe(0);
  });

  // ── Error (ok: false) ─────────────────────────────────────────────────────

  it('shows OFFLINE status when API returns ok=false', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, message: 'PostGIS ej tillgänglig', details: 'Connection refused' }),
    });
    render(<SystemStatus />);
    await waitFor(() => expect(screen.getByText('OFFLINE')).toBeInTheDocument());
  });

  it('shows details when ok=false', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, message: 'Fel', details: 'ECONNREFUSED' }),
    });
    render(<SystemStatus />);
    await waitFor(() => expect(screen.getByText('ECONNREFUSED')).toBeInTheDocument());
  });

  it('shows error message when fetch throws', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network down'));
    render(<SystemStatus />);
    await waitFor(() => expect(screen.getByText('Kunde inte nå API-endpoint.')).toBeInTheDocument());
  });

  it('shows OFFLINE when fetch throws', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));
    render(<SystemStatus />);
    await waitFor(() => expect(screen.getByText('OFFLINE')).toBeInTheDocument());
  });
});
