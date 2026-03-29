import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProjectPlan } from '../../services/projectStructure';

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
    render(<ProjectManagerView activeTab="plan" />);
    const input = screen.getByPlaceholderText('Projektnamn...');
    expect(input).toBeInTheDocument();
  });

  it('renders Sammanstall Styrdokument button in plan tab', () => {
    render(<ProjectManagerView activeTab="plan" />);
    expect(screen.getByText(/Sammanst.*ll Styrdokument/i)).toBeInTheDocument();
  });

  it('renders Utvardera gates button in plan tab', () => {
    render(<ProjectManagerView activeTab="plan" />);
    expect(screen.getByText(/Utv.*rdera gates/i)).toBeInTheDocument();
  });

  it('renders gates stats in plan tab', () => {
    render(<ProjectManagerView activeTab="plan" />);
    expect(screen.getByText(/Gates:/i)).toBeInTheDocument();
  });

  // ── timeline tab ─────────────────────────────────────────────────────────

  it('renders GanttChart in timeline tab', () => {
    render(<ProjectManagerView activeTab="timeline" />);
    expect(screen.getByTestId('gantt-chart')).toBeInTheDocument();
  });

  // ── org chart inside plan tab ──────────────────────────────────────────────

  it('renders ProjectOrgChart in plan tab', () => {
    render(<ProjectManagerView activeTab="plan" />);
    expect(screen.getByTestId('project-org-chart')).toBeInTheDocument();
  });

  // ── risks tab ─────────────────────────────────────────────────────────────

  it('renders Riskhanteringsplan heading in risks tab', () => {
    render(<ProjectManagerView activeTab="risks" />);
    expect(screen.getByText(/Riskhanteringsplan/i)).toBeInTheDocument();
  });

  // ── unknown tab (defaults to plan view) ──────────────────────────────────

  it('does not crash for unknown activeTab', () => {
    expect(() => render(<ProjectManagerView activeTab="unknown" />)).not.toThrow();
  });
});
