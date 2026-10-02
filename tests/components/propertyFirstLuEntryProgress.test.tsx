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
    // W-M2d item 5: a lasting gap in the property data is not something a new attempt changes.
    expect(screen.queryByTestId('pf-retry')).not.toBeInTheDocument();
  });

  it('W-M2d item 6: an ambiguous designation says it is a known limitation of the property data -- not the user\'s search, and no retry', async () => {
    const user = userEvent.setup();
    client.listPropertyProjects.mockResolvedValue([]);
    client.getBootstrapStatus.mockResolvedValue({
      status: 'FAILED',
      failureCode: 'PROPERTY_LOOKUP_AMBIGUOUS',
      failureDetail: 'PROPERTY_LOOKUP_AMBIGUOUS: exact designation "UPPSALA SVIA 1:111" matched 2 property_unit rows; refusing to choose one',
    });
    await searchAndCreate(user);
    expect(await screen.findByTestId('pf-bootstrap-failure-reason')).toHaveTextContent(
      'Fastigheten kan inte analyseras ännu: beteckningen är inte unik i fastighetsunderlaget. Det är en känd begränsning i underlaget, inte ett fel i din sökning.',
    );
    const failed = screen.getByTestId('pf-bootstrap-failed');
    expect(failed).not.toHaveTextContent(/förrän detta lyckas|inte verifierad/);
    expect(screen.queryByTestId('pf-retry')).not.toBeInTheDocument();
    expect(screen.getByText('Teknisk information').closest('details')!).toHaveTextContent('PROPERTY_LOOKUP_AMBIGUOUS');
  });

  it('W-M2d items 5+6: a technical bootstrap failure still offers a retry', async () => {
    const user = userEvent.setup();
    client.listPropertyProjects.mockResolvedValue([]);
    client.getBootstrapStatus.mockResolvedValue({ status: 'FAILED', failureCode: 'BOOTSTRAP_EXECUTION_ERROR', failureDetail: 'ECONNRESET' });
    await searchAndCreate(user);
    expect(await screen.findByTestId('pf-bootstrap-failure-reason')).toHaveTextContent('Ett tekniskt fel uppstod när fastigheten skulle knytas till lokaliseringen.');
    expect(screen.getByTestId('pf-retry')).toBeInTheDocument();
  });

  it.each([
    ['CURRENT_BINDING_INTEGRITY_FAULT', 'bestående lagrings- eller integritetsfel', false],
    ['CURRENT_BINDING_REFUSED', 'underkändes vid kontrollen', false],
    ['CURRENT_BINDING_READ_ERROR', 'på grund av ett tekniskt fel', true],
    ['PROPERTY_MISMATCH', 'stämmer inte med lokaliseringens egen fastighet', false],
  ] as const)('W-M2e item 2 (W-BOOT): bootstrap failure %s has its own reason; a lasting one offers no retry', async (failureCode, text, retry) => {
    const user = userEvent.setup();
    client.listPropertyProjects.mockResolvedValue([]);
    client.getBootstrapStatus.mockResolvedValue({ status: 'FAILED', failureCode, failureDetail: 'Projektets aktuella bindning ...' });
    await searchAndCreate(user);
    const reason = await screen.findByTestId('pf-bootstrap-failure-reason');
    expect(reason).toHaveTextContent(text);
    expect(reason).not.toHaveTextContent(/Fastigheten kunde inte knytas till lokaliseringen\.|[A-Z]{3,}_[A-Z_]{3,}/);
    if (retry) expect(screen.getByTestId('pf-retry')).toBeInTheDocument();
    else expect(screen.queryByTestId('pf-retry')).not.toBeInTheDocument();
  });

  it('DEMO M2b item 3: a failed search or create is plain Swedish; the raw server text stays collapsed', async () => {
    const user = userEvent.setup();
    client.listPropertyProjects.mockRejectedValueOnce(Object.assign(new Error('Not authorized for this project.'), { status: 403 }));
    render(<PropertyFirstLuEntry />);
    await user.type(screen.getByTestId('pf-designation'), 'UPPSALA SVIA 1:111');
    await user.click(screen.getByTestId('pf-search'));
    expect(await screen.findByTestId('pf-search-error-message')).toHaveTextContent(
      'Fastighetssökningen misslyckades. Du saknar behörighet till det här projektet.',
    );
    expect(screen.getByTestId('pf-search-error-message')).not.toHaveTextContent('Not authorized');
    expect(screen.getByTestId('pf-search-error-technical')).toHaveTextContent('Not authorized for this project.');

    client.listPropertyProjects.mockResolvedValue([]);
    client.createLocalizationProjectRequest.mockRejectedValueOnce(
      Object.assign(new Error('propertyDesignation and name are required'), { status: 400 }),
    );
    await user.click(screen.getByTestId('pf-search'));
    await user.click(await screen.findByTestId('pf-create-new'));
    expect(await screen.findByTestId('pf-search-error-message')).toHaveTextContent('Lokaliseringen kunde inte skapas.');
    expect(screen.getByTestId('pf-search-error-message')).not.toHaveTextContent('propertyDesignation');
  });

  it('DEMO M2b: a failed bootstrap retry is shown (it used to be set but never displayed in that phase)', async () => {
    const user = userEvent.setup();
    client.listPropertyProjects.mockResolvedValue([]);
    client.getBootstrapStatus.mockResolvedValue({ status: 'FAILED', failureCode: 'X', failureDetail: null });
    client.retryLocalizationBootstrap.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await searchAndCreate(user);
    await user.click(await screen.findByTestId('pf-retry'));
    expect(await screen.findByTestId('pf-retry-error-message')).toHaveTextContent(
      'Det gick inte att försöka igen. Ett tekniskt fel uppstod på servern.',
    );
  });
});
