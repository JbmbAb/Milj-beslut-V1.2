import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WeatherRisk from '../../components/WeatherRisk';

vi.mock('../../services/weatherService', () => ({
  fetchSmhiWeatherRisk: vi.fn(),
}));

import { fetchSmhiWeatherRisk } from '../../services/weatherService';

const fetchMock = fetchSmhiWeatherRisk as ReturnType<typeof vi.fn>;

describe('WeatherRisk', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── No coordinates ──────────────────────────────────────────────────────────

  it('shows Medel risk when no coordinates provided', async () => {
    render(<WeatherRisk municipality="Haninge" coordinates={null} />);
    await waitFor(() => expect(screen.getByText(/Risk: Medel/)).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows municipality name in description when no coordinates', async () => {
    render(<WeatherRisk municipality="Haninge" />);
    await waitFor(() => expect(screen.getByText(/Haninge/)).toBeInTheDocument());
  });

  it('shows manual review source when no coordinates', async () => {
    render(<WeatherRisk municipality="Haninge" />);
    await waitFor(() => expect(screen.getByText(/Manuell kontroll/)).toBeInTheDocument());
  });

  // ── Loading state ───────────────────────────────────────────────────────────

  it('shows loading spinner initially', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <WeatherRisk municipality="Stockholm" coordinates={{ lat: 59.3, lng: 18.06 }} />,
    );
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  // ── Success states ──────────────────────────────────────────────────────────

  it('shows Hög risk level', async () => {
    fetchMock.mockResolvedValue({
      level: 'Hög',
      description: 'Stor risk för regn',
      action: 'Stoppa arbete',
      source: 'smhi_pmp3g',
      municipality: 'Stockholm',
    });
    render(<WeatherRisk municipality="Stockholm" coordinates={{ lat: 59.3, lng: 18.06 }} />);
    await waitFor(() => expect(screen.getByText(/Risk: Hög/)).toBeInTheDocument());
  });

  it('shows Låg risk level', async () => {
    fetchMock.mockResolvedValue({
      level: 'Låg',
      description: 'Bra väder',
      action: 'Fortsätt arbete',
      source: 'smhi_pmp3g',
    });
    render(<WeatherRisk municipality="Malmö" coordinates={{ lat: 55.6, lng: 13.0 }} />);
    await waitFor(() => expect(screen.getByText(/Risk: Låg/)).toBeInTheDocument());
  });

  it('shows SMHI source label', async () => {
    fetchMock.mockResolvedValue({
      level: 'Medel',
      description: 'Normalt väder',
      action: 'Fortsätt med försiktighet',
      source: 'smhi_pmp3g',
    });
    render(<WeatherRisk municipality="Göteborg" coordinates={{ lat: 57.7, lng: 11.9 }} />);
    await waitFor(() => expect(screen.getByText(/SMHI PMP3G/)).toBeInTheDocument());
  });

  it('shows description text', async () => {
    fetchMock.mockResolvedValue({
      level: 'Medel',
      description: 'Regn förväntas under eftermiddagen',
      action: 'Ta skydd',
      source: 'smhi_pmp3g',
    });
    render(<WeatherRisk municipality="Uppsala" coordinates={{ lat: 59.8, lng: 17.6 }} />);
    await waitFor(() => expect(screen.getByText('Regn förväntas under eftermiddagen')).toBeInTheDocument());
  });

  it('renders temperature metric when summary provided', async () => {
    fetchMock.mockResolvedValue({
      level: 'Låg',
      description: 'Fint',
      action: 'OK',
      source: 'smhi_pmp3g',
      summary: {
        airTemperatureC: 15.5,
        windSpeedMs: 3.2,
        gustMs: null,
        precipitationMmPerHour: 0,
        thunderstormRiskPct: 0,
        symbolCode: 1,
      },
    });
    render(<WeatherRisk municipality="Lund" coordinates={{ lat: 55.7, lng: 13.2 }} />);
    await waitFor(() => expect(screen.getByText(/15.5 C/)).toBeInTheDocument());
  });

  // ── Error fallback ──────────────────────────────────────────────────────────

  it('shows manual review fallback when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));
    render(<WeatherRisk municipality="Luleå" coordinates={{ lat: 65.5, lng: 22.1 }} />);
    await waitFor(() => expect(screen.getByText(/Manuell kontroll/)).toBeInTheDocument());
  });

  it('shows municipality in error fallback description', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    render(<WeatherRisk municipality="Kiruna" coordinates={{ lat: 67.8, lng: 20.2 }} />);
    await waitFor(() => expect(screen.getByText(/Kiruna/)).toBeInTheDocument());
  });
});
