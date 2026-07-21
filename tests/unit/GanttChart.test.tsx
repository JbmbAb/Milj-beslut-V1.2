/**
 * Tests fÃ¶r components/GanttChart.tsx
 * TÃ¤cker Gantt-diagram rendering, dynamisk data och interaktioner
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GanttChart from '../../components/GanttChart';
import type { ProjectPhase, Task } from '../../types';

describe('GanttChart', () => {
  it('shows empty state when no phases provided', () => {
    render(<GanttChart phases={undefined} />);
    expect(screen.getByText(/Ingen tidplan genererad/i)).toBeInTheDocument();
  });

  it('shows empty state when phases array is empty', () => {
    render(<GanttChart phases={[]} />);
    expect(screen.getByText(/Ingen tidplan genererad/i)).toBeInTheDocument();
  });

  it('renders Gantt chart header when phases are provided', async () => {
    const phases: ProjectPhase[] = [
      {
        id: 'phase1',
        title: 'Planering',
        status: 'TODO',
        tasks: [
          {
            id: 'task1',
            title: 'Basanalys',
            startWeek: 1,
            duration: 2,
            type: 'TECHNICAL',
            status: 'DONE',
          } as Task,
        ],
        isLocked: false,
        requiresSignature: false,
      },
    ];

    render(<GanttChart phases={phases} />);
    expect(await screen.findByText('Projekt-Tidplan')).toBeInTheDocument();
  });

  it('renders month headers', async () => {
    const phases: ProjectPhase[] = [
      {
        id: 'phase1',
        title: 'Planering',
        status: 'TODO',
        tasks: [
          {
            id: 'task1',
            title: 'Test',
            startWeek: 1,
            duration: 1,
            type: 'TECHNICAL',
            status: 'TODO',
          } as Task,
        ],
        isLocked: false,
        requiresSignature: false,
      },
    ];

    render(<GanttChart phases={phases} />);
    expect(await screen.findByText('Jan')).toBeInTheDocument();
    expect(screen.getByText('Dec')).toBeInTheDocument();
  });

  it('renders task rows for all tasks in all phases', async () => {
    const phases: ProjectPhase[] = [
      {
        id: 'phase1',
        title: 'Planering',
        status: 'TODO',
        tasks: [
          {
            id: 'task1',
            title: 'Basanalys',
            startWeek: 1,
            duration: 2,
            type: 'TECHNICAL',
            status: 'DONE',
          } as Task,
          {
            id: 'task2',
            title: 'Samråd',
            startWeek: 3,
            duration: 1,
            type: 'LEGAL',
            status: 'ONGOING',
          } as Task,
        ],
        isLocked: false,
        requiresSignature: false,
      },
      {
        id: 'phase2',
        title: 'Undersökning',
        status: 'TODO',
        tasks: [
          {
            id: 'task3',
            title: 'Fältarbete',
            startWeek: 4,
            duration: 4,
            type: 'FIELD',
            status: 'TODO',
          } as Task,
        ],
        isLocked: false,
        requiresSignature: false,
      },
    ];

    render(<GanttChart phases={phases} />);
    expect(await screen.findByText('Basanalys')).toBeInTheDocument();
    expect(screen.getByText('Samråd')).toBeInTheDocument();
    // Appears both in legend and as a task title.
    expect(screen.getAllByText('Fältarbete').length).toBeGreaterThanOrEqual(2);
  });

  it('displays phase titles in task rows', async () => {
    const phases: ProjectPhase[] = [
      {
        id: 'phase1',
        title: 'Planering',
        status: 'TODO',
        tasks: [
          {
            id: 'task1',
            title: 'Basanalys',
            startWeek: 1,
            duration: 2,
            type: 'TECHNICAL',
            status: 'DONE',
          } as Task,
        ],
        isLocked: false,
        requiresSignature: false,
      },
    ];

    render(<GanttChart phases={phases} />);
    expect(await screen.findByText('Planering')).toBeInTheDocument();
  });

  it('shows legend with task types', async () => {
    const phases: ProjectPhase[] = [
      {
        id: 'phase1',
        title: 'Planering',
        status: 'TODO',
        tasks: [
          {
            id: 'task1',
            title: 'Test',
            startWeek: 1,
            duration: 1,
            type: 'TECHNICAL',
            status: 'TODO',
          } as Task,
        ],
        isLocked: false,
        requiresSignature: false,
      },
    ];

    render(<GanttChart phases={phases} />);
    expect(await screen.findByText('Juridisk process')).toBeInTheDocument();
    expect(screen.getByText('Tekniskt underlag')).toBeInTheDocument();
    expect(screen.getByText('Fältarbete')).toBeInTheDocument();
  });

  it('does not render hardcoded mock tasks', async () => {
    const phases: ProjectPhase[] = [
      {
        id: 'phase1',
        title: 'Planering',
        status: 'TODO',
        tasks: [
          {
            id: 'task1',
            title: 'Annan aktivitet',
            startWeek: 1,
            duration: 1,
            type: 'TECHNICAL',
            status: 'TODO',
          } as Task,
        ],
        isLocked: false,
        requiresSignature: false,
      },
    ];

    render(<GanttChart phases={phases} />);

    // Wait for rendering
    await screen.findByText('Annan aktivitet');

    // Verify no hardcoded mock data appears
    expect(screen.queryByText('Inledande platsspecifik riskanalys')).not.toBeInTheDocument();
    expect(screen.queryByText('Ansökan enligt 90-serien')).not.toBeInTheDocument();
  });

  it('calculates and displays total duration in footer', async () => {
    const phases: ProjectPhase[] = [
      {
        id: 'phase1',
        title: 'Planering',
        status: 'TODO',
        tasks: [
          {
            id: 'task1',
            title: 'Task1',
            startWeek: 1,
            duration: 5,
            type: 'TECHNICAL',
            status: 'TODO',
          } as Task,
        ],
        isLocked: false,
        requiresSignature: false,
      },
    ];

    render(<GanttChart phases={phases} />);
    expect(await screen.findByText(/6 Veckor/)).toBeInTheDocument(); // 1 + 5
  });

  it('displays phase count in footer', async () => {
    const phases: ProjectPhase[] = [
      {
        id: 'phase1',
        title: 'Planering',
        status: 'TODO',
        tasks: [
          {
            id: 'task1',
            title: 'Task1',
            startWeek: 1,
            duration: 1,
            type: 'TECHNICAL',
            status: 'TODO',
          } as Task,
        ],
        isLocked: false,
        requiresSignature: false,
      },
      {
        id: 'phase2',
        title: 'Implementering',
        status: 'TODO',
        tasks: [],
        isLocked: false,
        requiresSignature: false,
      },
    ];

    render(<GanttChart phases={phases} />);
    expect(await screen.findByText(/2 St/)).toBeInTheDocument();
  });
});
