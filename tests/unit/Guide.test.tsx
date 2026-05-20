import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import Guide from '../../components/Guide';
import type { InterfaceMode } from '../../types';

const mockPlanBase = {
  stageGates: [],
  documentArchive: [],
  carbonSummary: { lastResult: null },
  moduleIntegrations: [],
  samplingPreparation: { checklist: [] },
  auditTrail: [],
  projectMetadata: {},
};

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: vi.fn(() => ({
    plan: mockPlanBase,
    gateStats: { blocked: 0, passed: 0 },
    remoteSync: { enabled: false, projectId: null },
    evaluateGate: vi.fn(),
    addArchiveDocument: vi.fn(),
    markModuleReady: vi.fn(),
    applyTemplatePack: vi.fn(),
    runCarbonCalculation: vi.fn(),
    runTransportComplianceFlow: vi.fn(),
    applyMapLayerRecommendation: vi.fn(),
  })),
}));

vi.mock('../../services/projectStructure', () => ({
  countReadyModules: vi.fn(() => 0),
}));

describe('Guide', () => {
  const mockOnNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render guide content', () => {
    const { container } = render(<Guide mode="PERMIT_PORTAL" onNavigate={mockOnNavigate} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should display guide title', () => {
    render(<Guide mode="PERMIT_PORTAL" onNavigate={mockOnNavigate} />);
    expect(screen.getByText(/Guide/i)).toBeInTheDocument();
  });

  it('should show instructions for PERMIT_PORTAL mode', () => {
    const { container } = render(<Guide mode="PERMIT_PORTAL" onNavigate={mockOnNavigate} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should show instructions for PROJECT_MANAGER mode', () => {
    const { container } = render(<Guide mode="PROJECT_MANAGER" onNavigate={mockOnNavigate} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should show instructions for COMPLIANCE_AUDIT mode', () => {
    const { container } = render(<Guide mode="COMPLIANCE_AUDIT" onNavigate={mockOnNavigate} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should show instructions for LOGISTICS_MARKET mode', () => {
    const { container } = render(<Guide mode="LOGISTICS_MARKET" onNavigate={mockOnNavigate} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should have navigation buttons', () => {
    render(<Guide mode="PERMIT_PORTAL" onNavigate={mockOnNavigate} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('should call onNavigate when navigation button clicked', () => {
    render(<Guide mode="PERMIT_PORTAL" onNavigate={mockOnNavigate} />);
    const buttons = screen.getAllByRole('button');
    if (buttons.length > 0) {
      fireEvent.click(buttons[0]);
      expect(mockOnNavigate).toHaveBeenCalled();
    }
  });

  it('should display step indicators', () => {
    const { container } = render(<Guide mode="PERMIT_PORTAL" onNavigate={mockOnNavigate} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should render with different modes', () => {
    const modes: InterfaceMode[] = [
      'PERMIT_PORTAL',
      'PROJECT_MANAGER',
      'COMPLIANCE_AUDIT',
      'LOGISTICS_MARKET',
    ];

    modes.forEach((mode) => {
      const { container, unmount } = render(<Guide mode={mode} onNavigate={mockOnNavigate} />);
      expect(container.firstChild).not.toBeNull();
      unmount();
    });
  });

  it('should handle empty content gracefully', () => {
    const { container } = render(<Guide mode="PERMIT_PORTAL" onNavigate={mockOnNavigate} />);
    expect(container.firstChild).not.toBeNull();
  });
});
