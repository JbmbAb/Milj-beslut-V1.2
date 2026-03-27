import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProjectPlan } from '../../services/projectStructure';

const defaultPlan = createDefaultProjectPlan();

const mockContext = {
  plan: defaultPlan,
  gateStats: { passed: 2, blocked: 1 },
  remoteSync: {
    enabled: false,
    projectId: '',
    syncing: false,
    lastLoadedAt: '',
    lastSavedAt: '',
    error: '',
  },
};

vi.mock('../../components/ProjectStructureContext', () => ({
  useProjectStructure: () => mockContext,
  ProjectStructureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ExecutiveSummary from '../../components/ExecutiveSummary';

describe('ExecutiveSummary', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error')),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Default (summary) mode ─────────────────────────────────────────────

  it('renders Verkstallande overblick heading', () => {
    render(<ExecutiveSummary />);
    expect(screen.getByText(/Verkst.*llande.*verblick/i)).toBeInTheDocument();
  });

  it('renders Projekt- och compliancesammanfattning heading', () => {
    render(<ExecutiveSummary />);
    expect(screen.getByText(/Projekt.*och.*compliancesammanfattning/i)).toBeInTheDocument();
  });

  it('renders KpiCard for Regelefterlevnadspoang', () => {
    render(<ExecutiveSummary />);
    expect(screen.getByText(/Regelefterlevnadspo.*ng/i)).toBeInTheDocument();
  });

  it('renders Gates godkanda KPI', () => {
    render(<ExecutiveSummary />);
    expect(screen.getByText(/Gates godk.*nda/i)).toBeInTheDocument();
  });

  it('renders Modulberedskap KPI', () => {
    render(<ExecutiveSummary />);
    expect(screen.getByText('Modulberedskap')).toBeInTheDocument();
  });

  it('renders Verifierade dokument KPI', () => {
    render(<ExecutiveSummary />);
    expect(screen.getByText('Verifierade dokument')).toBeInTheDocument();
  });

  it('shows LOKAL when remoteSync is disabled', () => {
    render(<ExecutiveSummary />);
    expect(screen.getByText(/LOKAL/i)).toBeInTheDocument();
  });

  // ── score mode ────────────────────────────────────────────────────────────

  it('renders compliance score circle in score mode', () => {
    render(<ExecutiveSummary mode="score" />);
    expect(screen.getByText(/Regelefterlevnadspo.*ng/i)).toBeInTheDocument();
  });

  it('renders Kontrollpunkter section in score mode', () => {
    render(<ExecutiveSummary mode="score" />);
    const items = screen.getAllByText(/Kontrollpunkter/i);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
