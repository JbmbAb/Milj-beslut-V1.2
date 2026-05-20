import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProjectPlan } from '../../services/projectStructure';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

function renderWithQuery(ui: React.ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const defaultPlan = createDefaultProjectPlan();

const mockContextValue = {
  plan: defaultPlan,
  setPlan: vi.fn(),
  updatePlan: vi.fn(),
  gateStats: { passed: 1, blocked: 0 },
  remoteSync: {
    enabled: false,
    projectId: '',
    syncing: false,
    lastLoadedAt: '',
    lastSavedAt: '',
    error: '',
  },
  applyTemplatePack: vi.fn().mockResolvedValue(undefined),
  evaluateGate: vi.fn().mockResolvedValue({ changed: false, status: 'PENDING' }),
  runCarbonCalculation: vi.fn().mockResolvedValue(undefined),
  applyMapLayerRecommendation: vi.fn().mockResolvedValue(undefined),
  loadPlanFromServer: vi.fn().mockResolvedValue(undefined),
  savePlanToServer: vi.fn().mockResolvedValue(undefined),
  addArchiveDocument: vi.fn(),
  syncPermitToArchive: vi.fn(),
  runTransportComplianceFlow: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: () => mockContextValue,
  ProjectStructureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/GanttChart', () => ({
  default: ({ phases }: { phases: unknown[] }) => (
    <div data-testid="gantt-chart" data-phases={phases.length} />
  ),
}));

vi.mock('../../components/ProjectOrgChart', () => ({
  default: () => <div data-testid="project-org-chart" />,
}));

vi.mock('../../components/ProjectPlanStructurePanel', () => ({
  default: () => <div data-testid="project-plan-structure-panel" />,
}));

vi.mock('../../services/geminiService', () => ({
  suggestStakeholders: vi.fn().mockResolvedValue([]),
  generatePlanDraft: vi.fn().mockResolvedValue({ background: '', description: '' }),
}));

import ProjectManagerView from '../../components/ProjectManagerView';

describe('ProjectManagerView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── plan tab ─────────────────────────────────────────────────────────────

  it('renders plan name input in plan tab', () => {
    renderWithQuery(<ProjectManagerView activeTab="plan" />);
    const input = screen.getByPlaceholderText('Projektnamn...');
    expect(input).toBeInTheDocument();
  });

  it('renders Sammanstall Styrdokument button in plan tab', () => {
    renderWithQuery(<ProjectManagerView activeTab="plan" />);
    expect(screen.getByText(/Sammanst.*ll Styrdokument/i)).toBeInTheDocument();
  });

  it('renders stop gates section in plan tab', () => {
    renderWithQuery(<ProjectManagerView activeTab="plan" />);
    expect(screen.getByText(/Ansvars-spärrar \(Stop Gates\)/i)).toBeInTheDocument();
  });

  it('renders default phase titles in plan tab', () => {
    renderWithQuery(<ProjectManagerView activeTab="plan" />);
    expect(screen.getByText(/Initiation and requirements/i)).toBeInTheDocument();
  });

  // ── timeline tab ─────────────────────────────────────────────────────────

  it('renders GanttChart in timeline tab', () => {
    renderWithQuery(<ProjectManagerView activeTab="timeline" />);
    expect(screen.getByTestId('gantt-chart')).toBeInTheDocument();
  });

  // ── org chart inside plan tab ──────────────────────────────────────────────

  it('renders ProjectOrgChart in plan tab', () => {
    renderWithQuery(<ProjectManagerView activeTab="plan" />);
    expect(screen.getByTestId('project-org-chart')).toBeInTheDocument();
  });

  // ── risks tab ─────────────────────────────────────────────────────────────

  it('risks tab renders shell without plan or timeline panels', () => {
    renderWithQuery(<ProjectManagerView activeTab="risks" />);
    expect(screen.queryByTestId('project-manager-plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gantt-chart')).not.toBeInTheDocument();
  });

  // ── unknown tab (defaults to plan view) ──────────────────────────────────

  it('does not crash for unknown activeTab', () => {
    expect(() => renderWithQuery(<ProjectManagerView activeTab="unknown" />)).not.toThrow();
  });
});
