import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PropertyFirstLuEntry } from '../../components/app/lu/PropertyFirstLuEntry';

const api = vi.hoisted(() => ({
  searchCanonicalPropertyCandidates: vi.fn(),
  listPropertyProjects: vi.fn(),
  createLocalizationProjectRequest: vi.fn(),
  getBootstrapStatus: vi.fn(),
  retryLocalizationBootstrap: vi.fn(),
}));

vi.mock('@miljobeslut/mps-identity', () => ({
  designTokens: { colors: { surfaceDarkStone: { hex: '#111' }, coreTurquoise: { hex: '#0cc' }, flowLightCyan: { hex: '#cff' }, coreGraphite: { hex: '#333' } } },
}));
vi.mock('../../components/app/lu/LuWorkspace', () => ({
  LuWorkspace: () => <div data-testid="lu-workspace" />,
}));
vi.mock('../../services/coreApiClient', () => ({ setActiveProjectId: vi.fn() }));
vi.mock('../../src/ui/api-client/localizationProjects.client', () => api);

describe('PropertyFirstLuEntry canonical selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.searchCanonicalPropertyCandidates.mockResolvedValue([
      { sourceKey: 'source-a', sourceDataset: 'lm_fastighetsytor', designation: 'FALKENBERG ULLARED 2:215', municipality: 'FALKENBERG', matchKind: 'fuzzy' },
      { sourceKey: 'source-b', sourceDataset: 'lm_fastighetsytor', designation: 'FALKENBERG ULLARED 2:216', municipality: 'FALKENBERG', matchKind: 'fuzzy' },
    ]);
    api.listPropertyProjects.mockResolvedValue([]);
  });

  it('requires an explicit candidate selection before a project can be created', async () => {
    const user = userEvent.setup();
    render(<PropertyFirstLuEntry />);

    await user.type(screen.getByTestId('pf-designation'), 'Ullared 2:215');
    await user.click(screen.getByTestId('pf-search'));

    expect(await screen.findByText('FALKENBERG ULLARED 2:215')).toBeInTheDocument();
    expect(screen.queryByTestId('pf-create-new')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('pf-select-source-a'));
    await user.click(screen.getByTestId('pf-create-new'));

    expect(api.createLocalizationProjectRequest).toHaveBeenCalledWith(expect.objectContaining({
      property: {
        sourceKey: 'source-a',
        sourceDataset: 'lm_fastighetsytor',
        designation: 'FALKENBERG ULLARED 2:215',
      },
    }));
  });

  it('opening an existing localization observes bootstrap-status so viewer capability can enqueue', async () => {
    api.listPropertyProjects.mockResolvedValue([
      { id: 'proj-ullared', name: 'LU Ullared', propertyDesignation: 'FALKENBERG ULLARED 2:215', status: 'ACTIVE', createdAt: '2026-08-26T00:00:00.000Z' },
    ]);
    api.getBootstrapStatus.mockResolvedValue({
      id: 'bootstrap-1',
      projectId: 'proj-ullared',
      propertyDesignation: 'FALKENBERG ULLARED 2:215',
      status: 'COMPLETED',
      contextBindingArtifactId: 'project-context-binding-current',
      failureCode: null,
      failureDetail: null,
    });

    const user = userEvent.setup();
    render(<PropertyFirstLuEntry />);
    await user.type(screen.getByTestId('pf-designation'), 'Ullared 2:215');
    await user.click(screen.getByTestId('pf-search'));
    await user.click(await screen.findByTestId('pf-select-source-a'));
    await user.click(await screen.findByTestId('pf-open-proj-ullared'));

    expect(api.getBootstrapStatus).toHaveBeenCalledWith('proj-ullared');
    expect(await screen.findByTestId('lu-workspace')).toBeInTheDocument();
  });
});
