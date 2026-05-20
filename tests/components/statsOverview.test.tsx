import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StatsOverview from '../../components/StatsOverview';
import { Stats } from '../../types';

const baseStats: Stats = {
  total: 100,
  bifall: 70,
  avslag: 30,
  municipalities: 15,
};

describe('StatsOverview', () => {
  it('renders all four stat cards', () => {
    render(<StatsOverview stats={baseStats} />);
    expect(screen.getByText('Totalt antal tillstånd')).toBeInTheDocument();
    expect(screen.getByText('Beviljade (BIFALL)')).toBeInTheDocument();
    expect(screen.getByText('Avslagna (AVSLAG)')).toBeInTheDocument();
    expect(screen.getByText('Kommuner')).toBeInTheDocument();
  });

  it('displays the correct total value', () => {
    render(<StatsOverview stats={baseStats} />);
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('displays the correct bifall count', () => {
    render(<StatsOverview stats={baseStats} />);
    expect(screen.getByText('70')).toBeInTheDocument();
  });

  it('displays the correct avslag count', () => {
    render(<StatsOverview stats={baseStats} />);
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('displays the correct municipality count', () => {
    render(<StatsOverview stats={baseStats} />);
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('renders a grid container', () => {
    const { container } = render(<StatsOverview stats={baseStats} />);
    const grid = container.firstChild as HTMLElement;
    expect(grid.className).toMatch(/grid/);
  });

  it('renders correctly with zero values', () => {
    render(<StatsOverview stats={{ total: 0, bifall: 0, avslag: 0, municipalities: 0 }} />);
    expect(screen.getAllByText('0')).toHaveLength(4);
  });
});
