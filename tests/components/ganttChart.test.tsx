/**
 * ganttChart.test.tsx
 *
 * Testar GanttChart-komponenten:
 *   - Visar tomt-läge när phases saknas
 *   - Visar tomt-läge när phases är tom array
 *   - Renderar tidplan-rubrik när phases finns
 *   - Visar uppgiftstitel i diagrammet
 *   - Visar fasrubrik för uppgifter
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import GanttChart from '../../components/GanttChart';
import type { ProjectPhase } from '../../types';

const SAMPLE_PHASE: ProjectPhase = {
  id: 'phase-1',
  title: 'Förberedelsefas',
  status: 'ONGOING',
  isLocked: false,
  requiresSignature: false,
  tasks: [
    {
      id: 'task-1',
      title: 'Miljöinventering',
      startWeek: 1,
      duration: 4,
      type: 'FIELD',
      status: 'TODO',
    },
    {
      id: 'task-2',
      title: 'Juridisk granskning',
      startWeek: 5,
      duration: 3,
      type: 'LEGAL',
      status: 'DONE',
    },
  ],
};

describe('GanttChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('visar tommeddelande när phases saknas (undefined)', () => {
    render(<GanttChart />);
    expect(screen.getByText(/Ingen tidplan genererad/i)).toBeInTheDocument();
  });

  it('visar tommeddelande när phases är tom array', () => {
    render(<GanttChart phases={[]} />);
    expect(screen.getByText(/Ingen tidplan genererad/i)).toBeInTheDocument();
  });

  it('renderar tidplan-rubrik när phases finns', () => {
    render(<GanttChart phases={[SAMPLE_PHASE]} />);
    expect(screen.getByText(/Projekt-Tidplan/i)).toBeInTheDocument();
  });

  it('visar uppgiftstitel för uppgifter i tidplanen', () => {
    render(<GanttChart phases={[SAMPLE_PHASE]} />);
    expect(screen.getByText('Miljöinventering')).toBeInTheDocument();
  });

  it('visar flera uppgifter i samma fas', () => {
    render(<GanttChart phases={[SAMPLE_PHASE]} />);
    expect(screen.getByText('Miljöinventering')).toBeInTheDocument();
    expect(screen.getByText('Juridisk granskning')).toBeInTheDocument();
  });
});
