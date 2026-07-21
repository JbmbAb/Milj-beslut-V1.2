/**
 * appReadinessPanel.test.tsx
 *
 * Testar AppReadinessPanel-komponenten:
 *   - Renderar header och garanti-rubrik
 *   - Visar loading-spinner under hämtning
 *   - Visar sammanfattningsbanner när rapport laddas
 *   - Visar tier-kort med namn och status
 *   - Visar felmeddelande om API returnerar fel
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';

import AppReadinessPanel from '../../components/AppReadinessPanel';

const SAMPLE_REPORT = {
  ok: true,
  appVersion: '1.2.0',
  checkedAt: new Date().toISOString(),
  overallReady: false,
  readyTiers: 1,
  totalTiers: 3,
  summary: '⚠️ Tier 1 OK – konfigurera DATABASE_URL och externa API:er för full funktion',
  tiers: [
    {
      tier: 1,
      label: 'Kodkvalitet',
      description: 'TypeScript, ESLint och enhetstester',
      ready: true,
      checks: [
        { name: 'TypeScript (0 fel)', ok: true, note: 'Verifieras vid varje build' },
        { name: 'ESLint (0 fel)', ok: true, note: 'Verifieras vid varje build' },
      ],
    },
    {
      tier: 2,
      label: 'Runtime',
      description: 'Databas och autentisering',
      ready: false,
      checks: [
        { name: 'PostgreSQL (DATABASE_URL)', ok: false, note: 'Saknas – sätt DATABASE_URL i .env' },
        { name: 'JWT_SECRET', ok: false, note: 'Saknas – sätt JWT_SECRET i .env' },
      ],
    },
    {
      tier: 3,
      label: 'Full funktion',
      description: 'Externa API:er',
      ready: false,
      checks: [
        { name: 'Lantmäteriet API', ok: false, note: 'Saknas' },
        { name: 'BankID (eID-autentisering)', ok: false, note: 'Saknas' },
      ],
    },
  ],
};

function mockFetchSuccess(report: object) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(report),
  } as Response);
}

function mockFetchError() {
  return vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Nätverksfel'));
}

describe('AppReadinessPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderar header och garanti-rubrik', async () => {
    mockFetchSuccess(SAMPLE_REPORT);
    render(<AppReadinessPanel />);
    expect(screen.getByText(/App-garanti/i)).toBeInTheDocument();
    expect(screen.getByText(/3-nivå garanti-matris/i)).toBeInTheDocument();
  });

  it('visar loading-spinner under hämtning', () => {
    vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {})); // never resolves
    render(<AppReadinessPanel />);
    expect(document.querySelector('.fa-spinner')).toBeTruthy();
  });

  it('visar sammanfattning och tier-information när rapport laddas', async () => {
    mockFetchSuccess(SAMPLE_REPORT);
    render(<AppReadinessPanel />);
    await waitFor(() => {
      expect(screen.getByText(/Tier 1 OK/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Kodkvalitet/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Runtime/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Full funktion/i).length).toBeGreaterThan(0);
  });

  it('visar felmeddelande om fetch kastar fel', async () => {
    mockFetchError();
    render(<AppReadinessPanel />);
    await waitFor(() => {
      expect(screen.getByText(/Kunde inte hämta hälsostatus/i)).toBeInTheDocument();
    });
  });

  it('Uppdatera-knapp triggar ny hämtning', async () => {
    const spy = mockFetchSuccess(SAMPLE_REPORT);
    render(<AppReadinessPanel />);
    await waitFor(() => screen.getByText(/App-garanti/i));
    const btn = screen.getByRole('button', { name: /Uppdatera/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
