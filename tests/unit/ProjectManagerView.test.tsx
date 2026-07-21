import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectManagerView from '../../components/ProjectManagerView';

const mockUseProjectStructure = vi.hoisted(() => vi.fn());
const mockUseProjectPlan = vi.hoisted(() => vi.fn());

vi.mock('../../components/GanttChart', () => ({
  default: () => <div data-testid="gantt-chart">Gantt Chart</div>,
}));

vi.mock('../../components/ProjectOrgChart', () => ({
  default: () => <div data-testid="org-chart">Org Chart</div>,
}));

vi.mock('../../components/ProjectPlanStructurePanel', () => ({
  default: () => <div data-testid="structure-panel">Structure Panel</div>,
}));

vi.mock('../../components/project/ProjectReportView', () => ({
  ProjectReportView: () => <div data-testid="report-view">Report View</div>,
}));

vi.mock('../../services/geminiService', () => ({
  generatePlanDraft: vi.fn(),
  suggestStakeholders: vi.fn(),
}));

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: mockUseProjectStructure,
}));

vi.mock('../../src/ui/hooks/useProjectPlan', () => ({
  useProjectPlan: mockUseProjectPlan,
}));

describe('ProjectManagerView', () => {
  const buildStructureState = (overrides: Record<string, unknown> = {}) => ({
    plan: {
      id: 'plan-1',
      name: 'Test Project',
      description: 'Test Description',
      revision: 'v1.0',
      location: { address: 'Test Address' },
      background: 'Background',
      stakeholders: [],
      phases: [],
      auditTrail: [],
      status: 'DRAFT',
      moduleIntegrations: [],
      stageGates: [],
      carbonSummary: { lastResult: null },
    },
    setPlan: vi.fn(),
    remoteSync: { projectId: 'proj-1' },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProjectStructure.mockReturnValue(buildStructureState());
    mockUseProjectPlan.mockReturnValue({ isSaving: false });
  });

  it('should render edit mode by default', () => {
    render(<ProjectManagerView activeTab="plan" />);

    expect(screen.getByDisplayValue('Test Project')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sammanställ styrdokument/i })).toBeInTheDocument();
  });

  it('should switch to report view when button clicked', async () => {
    render(<ProjectManagerView activeTab="plan" />);

    fireEvent.click(screen.getByRole('button', { name: /sammanställ styrdokument/i }));

    await waitFor(() => {
      expect(screen.getByTestId('report-view')).toBeInTheDocument();
    });
  });

  it('should handle plan updates', async () => {
    const mockSetPlan = vi.fn();
    mockUseProjectStructure.mockReturnValue(
      buildStructureState({
        setPlan: mockSetPlan,
      }),
    );

    render(<ProjectManagerView activeTab="plan" />);

    fireEvent.change(screen.getByDisplayValue('Test Project'), {
      target: { value: 'New Project Name' },
    });

    await waitFor(() => {
      expect(mockSetPlan).toHaveBeenCalled();
    });
  });

  it('should render different tabs based on activeTab prop', () => {
    const { rerender } = render(<ProjectManagerView activeTab="plan" />);

    expect(screen.getByDisplayValue('Test Project')).toBeInTheDocument();

    rerender(<ProjectManagerView activeTab="timeline" />);

    expect(screen.getByTestId('gantt-chart')).toBeInTheDocument();
  });

  it('should handle isSaving state display', () => {
    mockUseProjectPlan.mockReturnValue({ isSaving: true });

    render(<ProjectManagerView activeTab="plan" />);

    expect(screen.getByText('Sparar...')).toBeInTheDocument();
  });

  it('should display gate info message only after events', () => {
    render(<ProjectManagerView activeTab="plan" />);

    expect(screen.queryByText(/kunde inte/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/intressentlista uppdaterad/i)).not.toBeInTheDocument();
  });
});
