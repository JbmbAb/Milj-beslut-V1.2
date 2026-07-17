import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IntegrationsDashboard from '../../components/IntegrationsDashboard';

vi.mock('../../services/coreApiClient', () => ({
  getToken: vi.fn(() => 'test-token'),
}));

vi.mock('../../components/SystemStatus', () => ({
  SystemStatus: () => <div data-testid="system-status" />,
}));

const catalogPayload = {
  ok: true,
  sources: [
    {
      name: 'Skyddad natur',
      activation: 'IMMEDIATE',
      reason: 'OK',
      implementationKey: 'naturvardsverket',
    },
    {
      name: 'SGU risklager',
      activation: 'PERMIT_REQUIRED',
      reason: 'Saknar tillstånd',
      implementationKey: 'sgu',
    },
  ],
};

const lantPayload = {
  ok: true,
  message: 'Lantmäteriet verifierat',
  status: 200,
};

const sluPayload = {
  ok: true,
  products: [{ product: 'artdata', hasApiKey: true, hasBasePath: true }],
};

const dispatchPayload = {
  ok: true,
  dispatch: {
    requestedProvider: 'MOCK_FRAKTBORS',
    activeProvider: 'MOCK_FRAKTBORS',
    fallbackActive: false,
    credentials: { timocomConfigured: false, transEuConfigured: false },
  },
  checkedAt: '2024-01-01T00:00:00Z',
};

const openSyncPayload = {
  ok: true,
  results: [
    {
      source: 'naturvardsverket',
      status: 200,
      ok: true,
      endpoint: 'https://example.test/nvr',
      details: 'Connected',
    },
    {
      source: 'sgu',
      status: 503,
      ok: false,
      endpoint: 'https://example.test/sgu',
      details: 'Saknar tillstånd',
    },
  ],
};

function successFetch(path: string) {
  if (path.includes('/api/datasources/catalog')) {
    return Promise.resolve({ ok: true, json: async () => catalogPayload });
  }
  if (path.includes('/api/datasources/lantmateriet')) {
    return Promise.resolve({ ok: true, json: async () => lantPayload });
  }
  if (path.includes('/api/datasources/slu/status')) {
    return Promise.resolve({ ok: true, json: async () => sluPayload });
  }
  if (path.includes('/api/admin/dispatch/provider')) {
    return Promise.resolve({ ok: true, json: async () => dispatchPayload });
  }
  if (path.includes('/api/datasources/open/sync')) {
    return Promise.resolve({ ok: true, json: async () => openSyncPayload });
  }
  return Promise.reject(new Error(`Unhandled fetch path: ${path}`));
}

function partialFailureFetch(path: string) {
  if (path.includes('/api/datasources/open/sync')) {
    return Promise.reject(new Error('network down'));
  }
  return successFetch(path);
}

describe('IntegrationsDashboard', () => {
  beforeEach(() => {
    vi.stubGlobal('setInterval', vi.fn().mockReturnValue(999));
    vi.stubGlobal('clearInterval', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the main heading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<IntegrationsDashboard />);
    expect(screen.getByText(/Systemarkitektur och API/i)).toBeInTheDocument();
  });

  it('shows integration cards from API response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input) => successFetch(String(input))),
    );
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getAllByText('Skyddad natur').length).toBeGreaterThan(0));
    expect(screen.getAllByText('SGU risklager').length).toBeGreaterThan(0);
  });

  it('shows CONNECTED badge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input) => successFetch(String(input))),
    );
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText('Aktiv')).toBeInTheDocument());
  });

  it('shows non-verified badge for permit-gated integrations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input) => successFetch(String(input))),
    );
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText('Ej verifierad')).toBeInTheDocument());
  });

  it('shows success info message after load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input) => successFetch(String(input))),
    );
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText(/Integrationskatalog laddad\./i)).toBeInTheDocument());
  });

  it('keeps initial cards visible before a failing livecheck is triggered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input) => partialFailureFetch(String(input))),
    );
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getAllByText('Skyddad natur').length).toBeGreaterThan(0));
  });

  it('shows backend error state when livecheck fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input) => partialFailureFetch(String(input))),
    );
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Kor livecheck/i })).toBeInTheDocument());
    screen.getByRole('button', { name: /Kor livecheck/i }).click();
    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
    expect(
      screen.getByText(/Integrationsstatus kunde inte verifieras utan giltig API-session\./i),
    ).toBeInTheDocument();
  });

  it('shows catalog error message when catalog request returns !ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input) => {
        const path = String(input);
        if (path.includes('/api/datasources/catalog')) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: async () => ({ ok: false, error: 'Service unavailable' }),
          });
        }
        return successFetch(path);
      }),
    );
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getByText(/Service unavailable/i)).toBeInTheDocument());
    expect(
      screen.getByText(/Integrationsstatus kunde inte verifieras utan giltig API-session\./i),
    ).toBeInTheDocument();
  });

  it('has an "Uppdatera" button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input) => successFetch(String(input))),
    );
    render(<IntegrationsDashboard />);
    await waitFor(() => expect(screen.getAllByText('Skyddad natur').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /Uppdatera/i })).toBeInTheDocument();
  });
});
