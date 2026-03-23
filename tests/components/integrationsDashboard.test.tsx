/**
 * integrationsDashboard.test.tsx
 *
 * Testar IntegrationsDashboard-komponenten:
 *   - Visar rubrik "Systemarkitektur och API"
 *   - Visar laddningsindikator medan fetch pågår
 *   - Visar integrationskortet för fallback-data
 *   - Hanterar fetch-fel utan att krascha
 *   - Visar Spatial Audit Engine-sektion
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import IntegrationsDashboard from '../../components/IntegrationsDashboard';

describe('IntegrationsDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('visar rubrik "Systemarkitektur och API"', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          summary: {
            cards: [],
            dispatch: {
              requestedProvider: 'DEMO_FRAKTBORS',
              activeProvider: 'DEMO_FRAKTBORS',
              fallbackActive: false,
              credentials: { timocomConfigured: false, transEuConfigured: false },
            },
            checkedAt: new Date().toISOString(),
          },
        }),
    } as Response);

    render(<IntegrationsDashboard />);

    await waitFor(() =>
      expect(screen.getByText(/Systemarkitektur och API/i)).toBeInTheDocument(),
    );
  });

  it('visar laddningsindikator medan fetch pågår', () => {
    vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {}));
    render(<IntegrationsDashboard />);
    expect(screen.getByText(/Laddar integrationsstatus/i)).toBeInTheDocument();
  });

  it('renderar fallback-kortet för skyddad natur', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    render(<IntegrationsDashboard />);

    // Fallback-data innehåller "Skyddad natur" från FALLBACK_CARDS
    await waitFor(
      () => expect(screen.getByText(/Skyddad natur/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('hanterar fetch-fel utan att krascha', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Timeout'));

    expect(() => render(<IntegrationsDashboard />)).not.toThrow();

    await waitFor(
      () => expect(screen.queryByText(/Systemarkitektur och API/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('visar Spatial Audit Engine-sektion', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          summary: {
            cards: [],
            dispatch: {
              requestedProvider: 'DEMO_FRAKTBORS',
              activeProvider: 'DEMO_FRAKTBORS',
              fallbackActive: false,
              credentials: { timocomConfigured: false, transEuConfigured: false },
            },
            checkedAt: new Date().toISOString(),
          },
        }),
    } as Response);

    render(<IntegrationsDashboard />);

    await waitFor(() =>
      expect(screen.getByText(/Spatial Audit Engine/i)).toBeInTheDocument(),
    );
  });
});
