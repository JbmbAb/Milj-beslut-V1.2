/**
 * statsOverview.test.tsx
 *
 * Testar StatsOverview-komponenten:
 *   - Renderar fyra StatCard-element
 *   - Visar korrekta siffror från props
 *   - Visar alla fyra etiketter
 *   - Hanterar noll-värden utan krasch
 *   - Varje kort har korrekt bakgrundsfärg
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import StatsOverview from '../../components/StatsOverview';

const SAMPLE_STATS = {
  total: 42,
  bifall: 28,
  avslag: 14,
  municipalities: 7,
};

describe('StatsOverview', () => {
  it('renderar alla fyra statistik-kort', () => {
    render(<StatsOverview stats={SAMPLE_STATS} />);
    const cards = document.querySelectorAll('.bg-white.rounded-xl');
    expect(cards.length).toBe(4);
  });

  it('visar korrekta siffror från props', () => {
    render(<StatsOverview stats={SAMPLE_STATS} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('visar alla fyra etiketter', () => {
    render(<StatsOverview stats={SAMPLE_STATS} />);
    expect(screen.getByText(/Totalt antal tillstånd/i)).toBeInTheDocument();
    expect(screen.getByText(/Beviljade/i)).toBeInTheDocument();
    expect(screen.getByText(/Avslagna/i)).toBeInTheDocument();
    expect(screen.getByText(/Kommuner/i)).toBeInTheDocument();
  });

  it('hanterar noll-värden utan krasch', () => {
    const zeroStats = { total: 0, bifall: 0, avslag: 0, municipalities: 0 };
    render(<StatsOverview stats={zeroStats} />);
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBe(4);
  });

  it('varje kort har sin ikonfärg (blå, grön, röd, lila)', () => {
    const { container } = render(<StatsOverview stats={SAMPLE_STATS} />);
    expect(container.querySelector('.bg-blue-500')).toBeTruthy();
    expect(container.querySelector('.bg-green-500')).toBeTruthy();
    expect(container.querySelector('.bg-red-500')).toBeTruthy();
    expect(container.querySelector('.bg-purple-500')).toBeTruthy();
  });
});
