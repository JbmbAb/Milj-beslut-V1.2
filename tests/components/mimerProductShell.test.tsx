import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MimerProductShell } from '../../components/app/MimerProductShell';

vi.mock('@miljobeslut/mps-compass', () => ({
  MpsCompass: () => <div data-testid="mps-compass" />,
}));

vi.mock('@miljobeslut/mps-identity', () => ({
  designTokens: {
    colors: {
      surfaceDarkStone: { hex: '#1C1C1E' },
      coreTurquoise: { hex: '#40E0D0' },
      flowLightCyan: { hex: '#E0FFFF' },
      coreGraphite: { hex: '#2C2C2E' },
      statusAudit: { hex: '#F0E68C' },
    },
  },
}));

vi.mock('@miljobeslut/mps-console', () => ({
  MpsConsoleApp: () => <div data-testid="mps-console-stub">Console</div>,
}));

vi.mock('../../components/app/lu/LuWorkspace', () => ({
  LuWorkspace: () => <div data-testid="lu-workspace" />,
}));

vi.mock('../../src/ui/api-client/localizationProjects.client', () => ({
  searchCanonicalPropertyCandidates: vi.fn(async () => [
    { sourceKey: 'orsa-1', sourceDataset: 'lm_fastighetsytor', designation: 'ORSA STACKMORA 3:12', municipality: 'ORSA', municipalityCode: '2039', countyCode: '20', matchKind: 'exact' },
  ]),
  listPropertyProjects: vi.fn(async () => [
    { id: 'proj-1', name: 'Alternativ A', propertyDesignation: 'ORSA STACKMORA 3:12', status: 'ACTIVE', createdAt: '2026-04-02T00:00:00.000Z' },
  ]),
  createLocalizationProjectRequest: vi.fn(),
  getBootstrapStatus: vi.fn(async () => ({
    status: {
      id: 'bootstrap-1',
      projectId: 'proj-1',
      propertyDesignation: 'ORSA STACKMORA 3:12',
      status: 'COMPLETED',
      contextBindingArtifactId: 'project-context-binding-1',
      failureCode: null,
      failureDetail: null,
    },
    diagnostics: null,
  })),
  retryLocalizationBootstrap: vi.fn(),
}));

describe('MimerProductShell', () => {
  it('shows only LU and admin in nav', () => {
    render(<MimerProductShell />);
    expect(screen.getByTestId('nav-localization')).toBeInTheDocument();
    expect(screen.getByTestId('nav-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-sewage')).not.toBeInTheDocument();
  });

  it('opens LuWorkspace for localization once a property is opened (not LocalizationStudyUI)', async () => {
    const user = userEvent.setup();
    render(<MimerProductShell userName="Test User" />);
    await user.click(screen.getByTestId('nav-localization'));
    expect(screen.getByTestId('product-localization')).toBeInTheDocument();
    expect(screen.getByTestId('lu-property-first-entry')).toBeInTheDocument();

    await user.type(screen.getByTestId('pf-designation'), 'ORSA STACKMORA 3:12');
    await user.click(screen.getByTestId('pf-search'));
    await user.click(await screen.findByTestId('pf-select-orsa-1'));
    await user.click(await screen.findByTestId('pf-open-proj-1'));

    expect(await screen.findByTestId('lu-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('localization-study-ui')).not.toBeInTheDocument();
  });

  it('opens admin console from home quick link', async () => {
    const user = userEvent.setup();
    render(<MimerProductShell />);
    await user.click(screen.getByTestId('home-open-admin'));
    expect(screen.getByTestId('product-admin')).toBeInTheDocument();
  });
});
