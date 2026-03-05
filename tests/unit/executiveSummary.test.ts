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
    expect(html).toContain('Compliance score');
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
    expect(html).toContain('LOKAL FALLBACK');
  });
});
