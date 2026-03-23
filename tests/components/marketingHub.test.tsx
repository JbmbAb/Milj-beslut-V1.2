/**
 * marketingHub.test.tsx
 *
 * Testar MarketingHub-komponenten:
 *   - Renderar "Generera Affärsinsikt"-knappen i idle-läge
 *   - Visar loading-spinner vid analys
 *   - Renderar analysresultat efter lyckat API-svar
 *   - Hanterar fel med offline-fallback-meddelande
 *   - Visar antal tillstånds-poster som skickas till analysen
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../services/geminiService', () => ({
  generateMarketingSummary: vi.fn(),
}));

import { generateMarketingSummary } from '../../services/geminiService';
import MarketingHub from '../../components/MarketingHub';
import type { Permit } from '../../types';
import { DecisionType } from '../../types';

const mockSummary = generateMarketingSummary as ReturnType<typeof vi.fn>;

const SAMPLE_PERMITS: Permit[] = [
  {
    id: '1',
    filename: 'beslut-2024.pdf',
    checksum: 'abc123',
    received_date: '2024-01-01',
    property_id: 'fastighet-001',
    municipality: 'Stockholm',
    waste_codes: '20 03 01',
    decision_type: DecisionType.BIFALL,
    full_text: 'Tillstånd för schaktarbeten i Stockholm.',
    processed_at: '2024-01-02',
  },
];

describe('MarketingHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderar "Kör Trend-motor"-knappen i idle-läge', () => {
    render(<MarketingHub permits={SAMPLE_PERMITS} />);
    expect(
      screen.getByRole('button', { name: /Kör Trend-motor/i }),
    ).toBeInTheDocument();
  });

  it('visar loading-spinner när analys pågår', async () => {
    mockSummary.mockReturnValue(new Promise(() => {})); // hänger

    render(<MarketingHub permits={SAMPLE_PERMITS} />);
    fireEvent.click(screen.getByRole('button', { name: /Kör Trend-motor/i }));

    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renderar analysresultat efter lyckat svar', async () => {
    mockSummary.mockResolvedValue({
      text: 'Marknadstrender pekar på ökad efterfrågan i Stockholmsregionen.',
      sources: [{ title: 'Rapport 2024', url: 'https://example.com' }],
    });

    render(<MarketingHub permits={SAMPLE_PERMITS} />);
    fireEvent.click(screen.getByRole('button', { name: /Kör Trend-motor/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/Marknadstrender pekar på ökad efterfrågan/i),
      ).toBeInTheDocument(),
    );
  });

  it('visar offline-fallback-text vid fel', async () => {
    mockSummary.mockRejectedValue(new Error('Nätverksfel'));

    render(<MarketingHub permits={SAMPLE_PERMITS} />);
    fireEvent.click(screen.getByRole('button', { name: /Kör Trend-motor/i }));

    await waitFor(() =>
      expect(screen.getByText(/Offline-lage/i)).toBeInTheDocument(),
    );
  });

  it('anropar generateMarketingSummary med permits-listan', async () => {
    mockSummary.mockResolvedValue({ text: 'OK', sources: [] });

    render(<MarketingHub permits={SAMPLE_PERMITS} />);
    fireEvent.click(screen.getByRole('button', { name: /Kör Trend-motor/i }));

    await waitFor(() => expect(mockSummary).toHaveBeenCalledTimes(1));
    expect(mockSummary).toHaveBeenCalledWith(SAMPLE_PERMITS);
  });
});
