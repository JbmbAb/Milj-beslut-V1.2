import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ExecutiveSummary from '../../components/ExecutiveSummary';
import { createDefaultProjectPlan } from '../../services/projectStructure';

const mockPlan = createDefaultProjectPlan();

const mockContext = {
  plan: mockPlan,
  gateStats: {
    blocked: 0,
    passed: 0,
  },
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
}));

describe('ExecutiveSummary', () => {
  it('renders compliance score in summary mode', () => {
    mockContext.plan = {
      ...createDefaultProjectPlan(),
      complianceScore: 88,
    };
    mockContext.gateStats = { blocked: 0, passed: 0 };

    const html = renderToStaticMarkup(React.createElement(ExecutiveSummary, { mode: 'summary' }));
    expect(html).toContain('Regelefterlevnadspoäng');
    expect(html).toContain('88/100');
  });

  it('renders lender report mode with remote fallback status text', () => {
    mockContext.plan = {
      ...createDefaultProjectPlan(),
      name: 'Rapporttest',
      location: {
        ...createDefaultProjectPlan().location,
        propertyId: 'TEST 1:1',
      },
    };
    mockContext.gateStats = { blocked: 1, passed: 2 };
    mockContext.remoteSync = {
      enabled: false,
      projectId: '',
      syncing: false,
      lastLoadedAt: '',
      lastSavedAt: '',
      error: '',
    };

    const html = renderToStaticMarkup(React.createElement(ExecutiveSummary, { mode: 'reports' }));
    expect(html).toContain('Risk- och genomforandestatus');
    expect(html).toMatch(/Remote sync:.*LOKAL/s);
  });

  it('renders score mode with circular progress element', () => {
    mockContext.plan = {
      ...createDefaultProjectPlan(),
      complianceScore: 75,
    };
    mockContext.gateStats = { blocked: 0, passed: 3 };

    const html = renderToStaticMarkup(React.createElement(ExecutiveSummary, { mode: 'score' }));
    expect(html).toContain('Regelefterlevnadspoäng');
    expect(html).toContain('75');
    expect(html).toContain('Kontrollpunkter');
  });

  it('uses default summary mode when no mode prop is provided', () => {
    mockContext.plan = { ...createDefaultProjectPlan(), complianceScore: 50 };
    mockContext.gateStats = { blocked: 0, passed: 0 };

    // No mode prop → should default to 'summary'
    const html = renderToStaticMarkup(React.createElement(ExecutiveSummary, {}));
    expect(html).toContain('Regelefterlevnadspoäng');
    expect(html).toContain('50/100');
  });

  it('shows remote sync session info when remoteSync is enabled', () => {
    mockContext.plan = { ...createDefaultProjectPlan(), complianceScore: 60 };
    mockContext.gateStats = { blocked: 0, passed: 1 };
    mockContext.remoteSync = {
      enabled: true,
      projectId: 'remote-proj-1',
      syncing: false,
      lastLoadedAt: '2026-01-01T10:00:00Z',
      lastSavedAt: '2026-01-01T10:05:00Z',
      error: '',
    };

    const html = renderToStaticMarkup(React.createElement(ExecutiveSummary, { mode: 'summary' }));
    expect(html).toContain('Regelefterlevnadspoäng');
    // Remote sync enabled with projectId → should not show LOKAL FALLBACK in summary mode
    expect(html).not.toContain('LOKAL FALLBACK');
  });
});
