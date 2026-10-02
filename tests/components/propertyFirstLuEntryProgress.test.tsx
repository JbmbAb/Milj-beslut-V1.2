import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PropertyFirstLuEntry } from '../../components/app/lu/PropertyFirstLuEntry';

// Fully mocked: no network, no database.
vi.mock('@miljobeslut/mps-identity', () => ({
  designTokens: {
    colors: {
      surfaceDarkStone: { hex: '#1C1C1E' },
      coreTurquoise: { hex: '#40E0D0' },
      flowLightCyan: { hex: '#E0FFFF' },
      coreGraphite: { hex: '#2C2C2E' },
    },
  },
}));
vi.mock('../../components/app/lu/LuWorkspace', () => ({ LuWorkspace: () => <div data-testid="lu-workspace" /> }));
vi.mock('../../services/coreApiClient', () => ({ setActiveProjectId: vi.fn() }));
const client = vi.hoisted(() => ({
  listPropertyProjects: vi.fn(),
  createLocalizationProjectRequest: vi.fn(),
  getBootstrapStatus: vi.fn(),
  retryLocalizationBootstrap: vi.fn(),
}));
vi.mock('../../src/ui/api-client/localizationProjects.client', () => client);

const PROJECT = { id: 'cmuq-internal-id', name: 'Alternativ A', propertyDesignation: 'UPPSALA SVIA 1:111', status: 'ACTIVE', createdAt: '2026-10-02T10:47:16.562Z' };

async function searchAndCreate(user: ReturnType<typeof userEvent.setup>) {
  render(<PropertyFirstLuEntry />);
  await user.type(screen.getByTestId('pf-designation'), 'UPPSALA SVIA 1:111');
  await user.click(screen.getByTestId('pf-search'));
  await user.click(await screen.findByTestId('pf-create-new'));
}

describe('DEMO M2a items 6+7: PropertyFirstLuEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    client.createLocalizationProjectRequest.mockResolvedValue({ project: PROJECT });
  });

  it('lists existing localizations by name and date, never by internal id or raw status', async () => {
    const user = userEvent.setup();
    client.listPropertyProjects.mockResolvedValue([{ ...PROJECT }, { ...PROJECT, id: 'cmuq-other', name: null }]);
    render(<PropertyFirstLuEntry />);
    await user.type(screen.getByTestId('pf-designation'), 'UPPSALA SVIA 1:111');
    await user.click(screen.getByTestId('pf-search'));
    const list = await screen.findByTestId('pf-existing-list');
    expect(list).toHaveTextContent('Alternativ A');
    expect(list).toHaveTextContent('Lokalisering utan namn');
    expect(list).toHaveTextContent('skapad');
    expect(list).not.toHaveTextContent('ACTIVE');
    expect(list).not.toHaveTextContent('cmuq-other');
  });

  it('shows step-by-step progress from the polled queue status in plain Swedish', async () => {
    const user = userEvent.setup();
    client.listPropertyProjects.mockResolvedValue([]);
    client.getBootstrapStatus.mockResolvedValue({ status: 'LEASED', failureCode: null, failureDetail: null });
    await searchAndCreate(user);
    expect(await screen.findByText('– pågår')).toBeInTheDocument();
    expect(screen.getByTestId('pf-progress-create')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('pf-progress-verify')).toHaveAttribute('data-state', 'active');
    const box = screen.getByTestId('pf-bootstrapping');
    expect(box).not.toHaveTextContent(/leased|pending|governad|projektkontext/i);
  });

  it('a failed bootstrap shows a Swedish reason; the raw code stays in a collapsed technical section', async () => {
    const user = userEvent.setup();
    client.listPropertyProjects.mockResolvedValue([]);
    client.getBootstrapStatus.mockResolvedValue({
      status: 'FAILED',
      failureCode: 'PROPERTY_CENTROID_UNAVAILABLE',
      failureDetail: 'no centroidSweref99Tm in lookup',
    });
    await searchAndCreate(user);
    expect(await screen.findByTestId('pf-bootstrap-failure-reason')).toHaveTextContent('Fastighetens mittpunkt kunde inte beräknas.');
    const technical = screen.getByText('Teknisk information').closest('details')!;
    expect(technical).not.toHaveAttribute('open');
    expect(technical).toHaveTextContent('PROPERTY_CENTROID_UNAVAILABLE');
    expect(screen.getByTestId('pf-retry')).toBeInTheDocument();
  });
});
