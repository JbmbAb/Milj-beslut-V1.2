/**
 * adminDbStatusPanel.test.tsx
 *
 * Testar AdminDbStatusPanel-komponenten:
 *   - Renderar header och rubrik
 *   - Visar loading-badge under auto-hämtning
 *   - Visar statistik-siffror när hämtning lyckas
 *   - Visar felmeddelande om API returnerar fel
 *   - "Uppdatera"-knapp triggar ny hämtning
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import AdminDbStatusPanel from '../../components/AdminDbStatusPanel';

// Helpers to build a successful fetch response
function mockFetchSuccess(stats: object) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        ok: true,
        stats,
      }),
  } as Response);
}

function mockFetchError(message: string) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    json: () => Promise.resolve({ ok: false, error: message }),
  } as Response);
}

const SAMPLE_STATS = {
  generatedAt: '2026-03-22T00:00:00.000Z',
  totals: {
    documents: 42,
    requirementsFromCases: 100,
    requirementsExtracted: 87,
    requirements: 187,
    municipalities: 5,
  },
  thresholds: {
    minRequirements: 50,
    minMunicipalities: 3,
    minDocuments: 10,
    requirementsOk: true,
    municipalitiesOk: true,
    documentsOk: true,
    allOk: true,
  },
  perMunicipality: [],
};

describe('AdminDbStatusPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Panelen autoladdar endast när admin-token finns
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-admin-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderar header och rubrik', () => {
    mockFetchSuccess(SAMPLE_STATS);
    render(<AdminDbStatusPanel />);
    expect(screen.getByText(/Databas\u00ADstatus/i)).toBeInTheDocument();
    expect(screen.getByText(/Admin · Databasstatus/i)).toBeInTheDocument();
  });

  it('visar loading-badge under hämtning', () => {
    vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {})); // hänger
    render(<AdminDbStatusPanel />);
    expect(screen.getByTestId('db-status-badge-loading')).toBeInTheDocument();
  });

  it('visar statistiksiffror och grön badge när hämtning lyckas', async () => {
    mockFetchSuccess(SAMPLE_STATS);
    render(<AdminDbStatusPanel />);

    await waitFor(() => expect(screen.getByTestId('db-kpi-documents-value')).toHaveTextContent('42'));

    expect(screen.getByTestId('db-kpi-requirements-value')).toHaveTextContent('187');
    expect(screen.getByTestId('db-kpi-municipalities-value')).toHaveTextContent('5');
    // Grön badge
    expect(document.querySelector('.bg-green-50')).toBeTruthy();
  });

  it('visar felmeddelande om API returnerar fel', async () => {
    mockFetchError('Databas ej tillgänglig');
    render(<AdminDbStatusPanel />);

    await waitFor(() => expect(screen.getByText(/Databas ej tillgänglig/i)).toBeInTheDocument());
    expect(document.querySelector('.bg-red-50')).toBeTruthy();
  });

  it('"Uppdatera"-knapp triggar ny hämtning', async () => {
    const fetchSpy = mockFetchSuccess(SAMPLE_STATS);
    render(<AdminDbStatusPanel />);

    // Vänta på att initial auto-load är klar
    await waitFor(() => expect(screen.getByTestId('db-kpi-documents-value')).toHaveTextContent('42'));

    // Knappen ska finnas och vara klickbar
    const btn = screen.getByRole('button', { name: /Uppdatera/i });
    expect(btn).toBeInTheDocument();

    fetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          stats: { ...SAMPLE_STATS, totals: { ...SAMPLE_STATS.totals, documents: 99 } },
        }),
    } as Response);

    fireEvent.click(btn);

    await waitFor(() => expect(screen.getByTestId('db-kpi-documents-value')).toHaveTextContent('99'));
    // fetch borde ha anropats 2 gånger totalt
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
