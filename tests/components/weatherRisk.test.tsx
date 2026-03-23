/**
 * weatherRisk.test.tsx
 *
 * Testar WeatherRisk-komponenten:
 *   - Visar loading-spinner tills prediktion är klar
 *   - Renderar prediktion (nivå, beskrivning, rekommendation)
 *   - Visar offline/demo-badge när API-nyckel saknas
 *   - Hanterar fel korrekt (visar fallback-text)
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mock geminiService ──────────────────────────────────────────────────────

vi.mock('../../services/geminiService', () => ({
  predictWeatherRisk: vi.fn(),
}));

import { predictWeatherRisk } from '../../services/geminiService';
import WeatherRisk from '../../components/WeatherRisk';

const mockPredict = predictWeatherRisk as ReturnType<typeof vi.fn>;

// ── Tester ─────────────────────────────────────────────────────────────────

describe('WeatherRisk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('visar loading-spinner medan prediktion hämtas', () => {
    // Häng aldrig klar
    mockPredict.mockReturnValue(new Promise(() => {}));
    render(<WeatherRisk municipality="Stockholm" />);
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renderar risk-nivå, beskrivning och rekommendation efter svar', async () => {
    mockPredict.mockResolvedValue({
      level: 'Medel',
      description: 'Kraftig regn förväntas under veckan.',
      action: 'Täck schaktgropar under natten.',
    });

    render(<WeatherRisk municipality="Haninge" />);

    await waitFor(() => expect(screen.getByText(/SMHI Prediktion/i)).toBeInTheDocument());

    expect(screen.getByText(/Risk: Medel/i)).toBeInTheDocument();
    expect(screen.getByText(/Kraftig regn förväntas/i)).toBeInTheDocument();
    expect(screen.getByText(/Täck schaktgropar/i)).toBeInTheDocument();
  });

  it('visar offline/demo-badge när description innehåller "offline"', async () => {
    mockPredict.mockResolvedValue({
      level: 'Låg',
      description: 'offline – saknar giltig API-nyckel',
      action: 'Kontrollera manuellt.',
    });

    render(<WeatherRisk municipality="Göteborg" />);

    await waitFor(() =>
      expect(screen.getByText(/Demo-läge/i)).toBeInTheDocument(),
    );
  });

  it('visar fallback-text och sätter offline=true vid kast', async () => {
    mockPredict.mockRejectedValue(new Error('Network error'));

    render(<WeatherRisk municipality="Malmö" />);

    await waitFor(() =>
      expect(screen.getByText(/Kunde inte hämta väderprognos/i)).toBeInTheDocument(),
    );
    // Demo-badge ska synas vid fel
    expect(screen.getByText(/Demo-läge/i)).toBeInTheDocument();
  });

  it('visar röd bakgrund vid risknivå Hög', async () => {
    mockPredict.mockResolvedValue({
      level: 'Hög',
      description: 'Extrem regn och storm väntas.',
      action: 'Stoppa arbete omedelbart.',
    });

    const { container } = render(<WeatherRisk municipality="Luleå" />);
    await waitFor(() => expect(screen.getByText(/Risk: Hög/i)).toBeInTheDocument());

    // Kontrollera att wrapper-div har rose-950 bakgrundsklass
    const wrapper = container.querySelector('.bg-rose-950');
    expect(wrapper).toBeTruthy();
  });
});
