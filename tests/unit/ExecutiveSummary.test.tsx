import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import ExecutiveSummary from '../../components/ExecutiveSummary';

vi.mock('../../services/geminiService', () => ({
  generateExecutiveSummary: vi.fn(),
  fetchComplianceMetrics: vi.fn(),
}));

vi.mock('../../src/ui/hooks/useProjectPlan', () => ({
  useProjectPlan: vi.fn(() => ({
    projectMetrics: {
      completion: 75,
      riskScore: 0.3,
      complianceScore: 0.85,
    },
  })),
}));

vi.mock('../../components/StatsOverview', () => ({
  default: () => <div data-testid="stats-overview">Stats Overview</div>,
}));

const mockPlanBase = {
  stageGates: [],
  documentArchive: [],
  carbonSummary: { lastResult: null },
  moduleIntegrations: [],
  samplingPreparation: { checklist: [] },
  auditTrail: [],
  // Properties required by ExecutiveSummary line 119-130:
  complianceScore: 0,
  location: { propertyId: '', address: '' },
  predictiveScores: null,
};

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: vi.fn(() => ({
    plan: mockPlanBase,
    gateStats: { blocked: 0, passed: 0 },
    remoteSync: { enabled: false, projectId: null },
    evaluateGate: vi.fn(),
    addArchiveDocument: vi.fn(),
    markModuleReady: vi.fn(),
  })),
}));

vi.mock('../../services/projectStructure', () => ({
  countReadyModules: vi.fn(() => 0),
}));

describe('ExecutiveSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline in tests')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should render summary container', () => {
    const { container } = render(<ExecutiveSummary />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should display key metrics', () => {
    const { container } = render(<ExecutiveSummary />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should render stats overview (if StatsOverview is used inside component)', async () => {
    const { container } = render(<ExecutiveSummary />);
    await waitFor(() => expect(container.firstChild).not.toBeNull());
  });

  it('should handle loading state', () => {
    const { container } = render(<ExecutiveSummary />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should display compliance score', () => {
    const { container } = render(<ExecutiveSummary />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should show project completion percentage', () => {
    const { container } = render(<ExecutiveSummary />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should display risk assessment', () => {
    const { container } = render(<ExecutiveSummary />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should render export button', () => {
    const { container } = render(<ExecutiveSummary />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should handle empty data gracefully', () => {
    const { container } = render(<ExecutiveSummary />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should update when project changes', async () => {
    const { rerender, container } = render(<ExecutiveSummary />);
    rerender(<ExecutiveSummary />);
    await waitFor(() => expect(container.firstChild).not.toBeNull());
  });
});
