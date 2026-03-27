import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GanttChart from '../../components/GanttChart';
import type { ProjectPhase } from '../../types';

const samplePhases: ProjectPhase[] = [
  {
    id: 'phase-1',
    title: 'Förundersökning',
    status: 'ONGOING',
    isLocked: false,
    requiresSignature: false,
    tasks: [
      { id: 't1', title: 'Riskanalys', startWeek: 1, duration: 4, type: 'TECHNICAL', status: 'DONE' },
      { id: 't2', title: 'Samråd', startWeek: 5, duration: 3, type: 'LEGAL', status: 'ONGOING' },
    ],
  },
  {
    id: 'phase-2',
    title: 'Ansökan',
    status: 'TODO',
    isLocked: false,
    requiresSignature: true,
    tasks: [{ id: 't3', title: 'MKB', startWeek: 8, duration: 8, type: 'LEGAL', status: 'TODO' }],
  },
];

describe('GanttChart', () => {
  // ── Empty / no phases ───────────────────────────────────────────────────────

  it('renders empty-state message when no phases provided', () => {
    render(<GanttChart />);
    expect(screen.getByText(/Ingen tidplan genererad/i)).toBeInTheDocument();
  });

  it('renders empty-state message when phases is empty array', () => {
    render(<GanttChart phases={[]} />);
    expect(screen.getByText(/Ingen tidplan genererad/i)).toBeInTheDocument();
  });

  // ── With phases ─────────────────────────────────────────────────────────────

  it('renders the Projekt-Tidplan heading', () => {
    render(<GanttChart phases={samplePhases} />);
    expect(screen.getByText('Projekt-Tidplan')).toBeInTheDocument();
  });

  it('renders all task titles', () => {
    render(<GanttChart phases={samplePhases} />);
    expect(screen.getByText('Riskanalys')).toBeInTheDocument();
    expect(screen.getByText('Samråd')).toBeInTheDocument();
    expect(screen.getByText('MKB')).toBeInTheDocument();
  });

  it('renders phase titles as task labels', () => {
    render(<GanttChart phases={samplePhases} />);
    expect(screen.getAllByText('Förundersökning').length).toBeGreaterThan(0);
  });

  it('renders month headers', () => {
    render(<GanttChart phases={samplePhases} />);
    expect(screen.getByText('Jan')).toBeInTheDocument();
    expect(screen.getByText('Jun')).toBeInTheDocument();
    expect(screen.getByText('Dec')).toBeInTheDocument();
  });

  it('renders legend items', () => {
    render(<GanttChart phases={samplePhases} />);
    expect(screen.getByText('Juridisk process')).toBeInTheDocument();
    expect(screen.getByText('Tekniskt underlag')).toBeInTheDocument();
    expect(screen.getByText('Fältarbete')).toBeInTheDocument();
  });

  it('does not show empty-state message when phases are present', () => {
    render(<GanttChart phases={samplePhases} />);
    expect(screen.queryByText(/Ingen tidplan genererad/i)).not.toBeInTheDocument();
  });
});
