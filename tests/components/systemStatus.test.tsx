/**
 * systemStatus.test.tsx
 *
 * Testar SystemStatus-komponenten:
 *   - Visar loading-skeleton medan API-anrop pågår
 *   - Renderar OK-status med grön bakgrund
 *   - Renderar felstatus med röd bakgrund
 *   - Hanterar nätverksfel korrekt (fetch kastar)
 *   - Renderar nothing om data saknas (säkerhetsfall)
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SystemStatus } from '../../components/SystemStatus';

// ── Tester ─────────────────────────────────────────────────────────────────

describe('SystemStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('visar loading-skeleton (animate-pulse) tills fetch är klar', () => {
    vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {}));
    render(<SystemStatus />);
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('visar grön OK-status när API svarar ok:true', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: () =>
        Promise.resolve({
          ok: true,
          version: 'PostGIS 3.5',
          message: 'PostGIS är aktivt',
        }),
    } as Response);

    render(<SystemStatus />);

    await waitFor(() =>
      expect(screen.getByText(/PostGIS är aktivt/i)).toBeInTheDocument(),
    );

    // Wrapper ska ha grön bakgrund
    expect(document.querySelector('.bg-emerald-50')).toBeTruthy();
  });

  it('visar röd felstatus när API svarar ok:false', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: () =>
        Promise.resolve({
          ok: false,
          message: 'PostGIS är inte tillgängligt',
          details: 'Connection refused',
        }),
    } as Response);

    render(<SystemStatus />);

    await waitFor(() =>
      expect(screen.getByText(/PostGIS är inte tillgängligt/i)).toBeInTheDocument(),
    );

    expect(document.querySelector('.bg-rose-50')).toBeTruthy();
  });

  it('hanterar nätverksfel gracefully (fetch kastar)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Failed to fetch'));

    render(<SystemStatus />);

    await waitFor(() =>
      expect(screen.getByText(/Kunde inte nå API-endpoint/i)).toBeInTheDocument(),
    );
  });

  it('visar versionsnummer när det finns i svaret', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      json: () =>
        Promise.resolve({
          ok: true,
          version: 'PostGIS 3.5.2',
          message: 'OK',
        }),
    } as Response);

    render(<SystemStatus />);

    await waitFor(() =>
      expect(screen.getByText(/PostGIS 3.5.2/i)).toBeInTheDocument(),
    );
  });
});
