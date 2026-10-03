/**
 * W-UI1 (B; W-CATCH2 #4, CATCH2-VERIFICATION finding 10; owner decision 2): "Försök igen" on a failed
 * project-context bootstrap is the SERVER's `retryable` on bootstrap-status -- never a client code list.
 * BOOTSTRAP_STORAGE_INTEGRITY_FAULT and BOOTSTRAP_REFUSED (server retryable:false) never offer it.
 * Fully mocked: no network, no database.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PropertyFirstLuEntry } from '../../components/app/lu/PropertyFirstLuEntry';

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

async function failWith(status: Record<string, unknown>) {
  const user = userEvent.setup();
  client.listPropertyProjects.mockResolvedValue([]);
  client.getBootstrapStatus.mockResolvedValue({ status: 'FAILED', failureDetail: 'Projektkontexten kunde inte etableras: ...', ...status });
  render(<PropertyFirstLuEntry />);
  await user.type(screen.getByTestId('pf-designation'), 'UPPSALA SVIA 1:111');
  await user.click(screen.getByTestId('pf-search'));
  await user.click(await screen.findByTestId('pf-create-new'));
  return { user, reason: await screen.findByTestId('pf-bootstrap-failure-reason') };
}

describe('W-UI1 B: bootstrap retry follows the server\'s retryable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    client.createLocalizationProjectRequest.mockResolvedValue({ project: PROJECT });
  });

  it.each([
    ['BOOTSTRAP_STORAGE_INTEGRITY_FAULT', 'bestående lagrings- eller integritetsfel'],
    ['BOOTSTRAP_REFUSED', 'underkändes vid kontrollen'],
  ] as const)('%s with retryable:false -- its own reason, no "Försök igen", "kan inte knytas"', async (failureCode, text) => {
    const { reason } = await failWith({ failureCode, retryable: false });
    expect(reason).toHaveTextContent(text);
    expect(reason).not.toHaveTextContent(/Fastigheten kunde inte knytas till lokaliseringen\.|[A-Z]{3,}_[A-Z_]{3,}/);
    expect(screen.queryByTestId('pf-retry')).not.toBeInTheDocument();
    expect(screen.getByTestId('pf-bootstrap-failed')).toHaveTextContent('fastigheten kan inte knytas till den');
  });

  it('a code the client used to retry by its own list gets no "Försök igen" when the server says retryable:false', async () => {
    await failWith({ failureCode: 'BOOTSTRAP_EXECUTION_ERROR', retryable: false });
    expect(screen.queryByTestId('pf-retry')).not.toBeInTheDocument();
  });

  it('a lasting code the server nevertheless marks retryable:true offers "Försök igen" -- the server decides', async () => {
    await failWith({ failureCode: 'PROPERTY_CENTROID_UNAVAILABLE', retryable: true });
    expect(screen.getByTestId('pf-retry')).toBeInTheDocument();
    expect(screen.getByTestId('pf-bootstrap-failed')).toHaveTextContent('ännu inte knuten till den');
  });

  it('an answer without a flag (an older server) and an unknown code: no "Försök igen", no cause claimed', async () => {
    const { reason } = await failWith({ failureCode: 'CURRENT_BINDING_NOT_FOUND' });
    expect(reason).toHaveTextContent('Fastigheten kunde inte knytas till lokaliseringen.');
    expect(reason).not.toHaveTextContent('hittades inte');
    expect(screen.queryByTestId('pf-retry')).not.toBeInTheDocument();
  });

  it('retryable:true on a technical fault: "Försök igen" re-queues the bootstrap', async () => {
    client.retryLocalizationBootstrap.mockResolvedValue({ bootstrapRequestId: 'r2', bootstrapStatus: 'PENDING' });
    const { user } = await failWith({ failureCode: 'BOOTSTRAP_EXECUTION_ERROR', retryable: true });
    await user.click(screen.getByTestId('pf-retry'));
    expect(client.retryLocalizationBootstrap).toHaveBeenCalledWith('cmuq-internal-id');
  });
});
