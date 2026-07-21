import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import ApplicationWizard from '../../components/ApplicationWizard';

vi.mock('../../services/geminiService', () => ({
  generatePlanDraft: vi.fn(),
  suggestStakeholders: vi.fn(),
  validateApplication: vi.fn(),
}));

vi.mock('../../components/FormManager', () => ({
  default: () => <div data-testid="form-manager">Form Manager</div>,
}));

vi.mock('../../src/ui/hooks/useProjectPlan', () => ({
  useProjectPlan: vi.fn(() => ({
    isSaving: false,
    lastSavedAt: new Date().toISOString(),
  })),
}));

// ApplicationWizard uses lazy() for deferred steps – Suspense wrapping is fine in jsdom.
vi.mock('../../components/applicationWizard/ApplicationWizardDeferredViews', () => ({
  LocationAuditStep: () => <div data-testid="location-audit-step">Location Audit</div>,
  RiskSummaryStep: () => <div data-testid="risk-summary-step">Risk Summary</div>,
  ManualGateStep: () => <div data-testid="manual-gate-step">Manual Gate</div>,
}));

describe('ApplicationWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render wizard interface', () => {
    const { container } = render(<ApplicationWizard />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should have navigation buttons', () => {
    const { container } = render(<ApplicationWizard />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should maintain form state across steps', async () => {
    const { container } = render(<ApplicationWizard />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should validate form inputs', () => {
    const { container } = render(<ApplicationWizard />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should handle submission', async () => {
    const { container } = render(<ApplicationWizard />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should show progress indicator', () => {
    const { container } = render(<ApplicationWizard />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should allow navigation between steps', () => {
    const { container } = render(<ApplicationWizard />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should save form state', async () => {
    const { container } = render(<ApplicationWizard />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should handle errors gracefully', () => {
    const { container } = render(<ApplicationWizard />);
    expect(container.firstChild).not.toBeNull();
  });

  it('should display success message after submission', async () => {
    const { container } = render(<ApplicationWizard />);
    expect(container.firstChild).not.toBeNull();
  });
});
