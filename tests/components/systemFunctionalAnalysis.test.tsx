import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemFunctionalAnalysis } from '../../components/SystemFunctionalAnalysis';
import type { FullStatusReport } from '../../types';

describe('SystemFunctionalAnalysis', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockReport: FullStatusReport = {
    overall: 'ok',
    generatedAt: new Date().toISOString(),
    app: {
      version: '1.0.0',
      environment: 'test',
      nodeVersion: '20',
      uptimeSeconds: 3600,
    },
    db: { status: 'ok', latencyMs: 45 },
    completion: {
      donePercent: 75,
      implementationPercent: 82,
      remainingPercent: 25,
      counts: { done: 3, partial: 1, pending: 0, total: 4 },
      categories: [
        {
          name: 'Authentication',
          done: 2,
          total: 2,
          percent: 100,
          partial: 0,
          pending: 0,
          features: [
            { id: '1', label: 'BankID', category: 'Auth', status: 'DONE', note: '' },
            { id: '2', label: 'Session', category: 'Auth', status: 'DONE', note: '' },
          ],
        },
      ],
      checkedAt: new Date().toISOString(),
    },
    integrations: [
      { name: 'Lantmäteriet', status: 'CONFIGURED', endpoint: '/api/lm', note: '' },
      { name: 'SLU', status: 'MOCK', endpoint: null, note: 'Demo mode' },
    ],
    datasources: {
      total: 5,
      connected: 3,
      cards: [],
    },
    environment: {
      configured: 10,
      total: 15,
      requiredMissing: [],
      vars: [
        { name: 'API_KEY', category: 'Core', configured: true, required: true, maskedValue: '****' },
        { name: 'DEBUG', category: 'Core', configured: false, required: false, maskedValue: null },
      ],
    },
    database: {
      totalRows: 50000,
      tables: [{ table: 'users', rows: 100, latestEntry: new Date().toISOString() }],
      recentAuditEvents: [],
      recentSearchQueries: [],
      pipelineRuns: [],
    },
    backup: {
      totalBackups: 5,
      latestBackupStatus: 'ok',
      latestBackupAt: new Date().toISOString(),
    },
    backgroundServices: {
      outlookScheduler: {
        running: true,
        intervalMs: 3600000,
        totalRuns: 10,
        lastRunAt: new Date().toISOString(),
      },
    },
    domstolRssScheduler: {
      running: false,
      intervalMs: 86400000,
      totalRuns: 0,
    },
    recentErrors: [],
  };

  // ── Loading state ────────────────────────────────────────────────────────

  it('shows loading state initially', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {
        // Never resolves
      }),
    );
    render(<SystemFunctionalAnalysis />);
    expect(screen.getByText(/Analyserar system/i)).toBeInTheDocument();
  });

  // ── Initial render with data ─────────────────────────────────────────────

  it('renders heading "Total Funktionsanalys"', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Total Funktionsanalys/i)).toBeInTheDocument();
    });
  });

  it('renders update button', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Uppdatera/i })).toBeInTheDocument();
    });
  });

  it('displays last refresh timestamp', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Senast uppdaterad:/i)).toBeInTheDocument();
    });
  });

  // ── Overall status banner ────────────────────────────────────────────────

  it('shows overall system status as ok', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Systemstatus:/i)).toBeInTheDocument();
    });
  });

  it('displays completion percentage', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText('75%')).toBeInTheDocument();
    });
  });

  it('displays database latency', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/DB-latens:\s*45 ms/i)).toBeInTheDocument();
    });
  });

  // ── Feature Completion section ───────────────────────────────────────────

  it('renders Feature Completion section', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Feature Completion/i)).toBeInTheDocument();
    });
  });

  it('displays feature completion counts', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Klara/i)).toBeInTheDocument();
      expect(screen.getByText(/Delvis/i)).toBeInTheDocument();
    });
  });

  it('renders category filter buttons', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Alla/i })).toBeInTheDocument();
    });
  });

  // ── Integrations section ─────────────────────────────────────────────────

  it('renders Integrations section', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getAllByText(/Integrationer/i).length).toBeGreaterThan(0);
    });
  });

  it('displays integration status counts', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/1 aktiva/i)).toBeInTheDocument();
      expect(screen.getByText(/1 ej konfigurerade/i)).toBeInTheDocument();
    });
  });

  it('shows warning when integrations are in mock mode', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/integrationer är ej konfigurerade eller blockerade/i)).toBeInTheDocument();
    });
  });

  // ── Environment Variables section ────────────────────────────────────────

  it('renders Environment Variables section', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Miljövariabler/i)).toBeInTheDocument();
    });
  });

  it('displays configured variables count', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/10 konfigurerade/i)).toBeInTheDocument();
    });
  });

  // ── Database section ─────────────────────────────────────────────────────

  it('renders Database section', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getAllByText(/Databas/i).length).toBeGreaterThan(0);
    });
  });

  it('displays database row count', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Totalt rader/i)).toBeInTheDocument();
    });
  });

  it('displays number of tables', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Tabeller/i)).toBeInTheDocument();
    });
  });

  // ── Background Services section ──────────────────────────────────────────

  it('renders Background Services section', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Bakgrundstjänster/i)).toBeInTheDocument();
    });
  });

  it('displays Outlook scheduler status', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Outlook-inläsare/i)).toBeInTheDocument();
    });
  });

  // ── Lantmäteriet test section ────────────────────────────────────────────

  it('renders Lantmäteriet test section', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Lantmäteriet — Testa riktiga koordinater/i)).toBeInTheDocument();
    });
  });

  it('renders Lantmäteriet test button', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: mockReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Testa anslutning nu/i })).toBeInTheDocument();
    });
  });

  // ── Lantmäteriet test interaction ────────────────────────────────────────

  it('runs Lantmäteriet test when button clicked', async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, report: mockReport }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            ok: true,
            mode: 'real',
            authMethod: 'OAuth2',
            tokenFetched: true,
            sampleLookupOk: true,
            sampleDesignation: '1:1',
            sampleGeometry: { type: 'Point', coordinates: [0, 0] },
            error: null,
            setupGuide: [],
          },
        }),
      });
    render(<SystemFunctionalAnalysis />);
    const testButton = await screen.findByRole('button', { name: /Testa anslutning nu/i });
    await user.click(testButton);
    await waitFor(() => {
      expect(screen.getByText(/Riktiga koordinater fungerar!/i)).toBeInTheDocument();
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  it('shows error message on API failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, error: 'API Error' }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/API Error/i)).toBeInTheDocument();
    });
  });

  it('shows error message on network failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network failed'));
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Network failed/i)).toBeInTheDocument();
    });
  });

  // ── Update button functionality ──────────────────────────────────────────

  it('refreshes data when update button is clicked', async () => {
    const user = userEvent.setup();
    let callCount = 0;
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ ok: true, report: mockReport }),
      };
    });
    render(<SystemFunctionalAnalysis />);
    await screen.findByText(/Total Funktionsanalys/i);
    const updateButton = screen.getByRole('button', { name: /Uppdatera/i });
    await user.click(updateButton);
    await waitFor(() => {
      expect(callCount).toBeGreaterThan(1);
    });
  });

  // ── Degraded status handling ─────────────────────────────────────────────

  it('shows degraded status indicator when system is degraded', async () => {
    const degradedReport = { ...mockReport, overall: 'degraded' };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: degradedReport }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/degraded/i)).toBeInTheDocument();
    });
  });

  // ── Required missing variables ───────────────────────────────────────────

  it('shows alert when required environment variables are missing', async () => {
    const reportWithMissing = {
      ...mockReport,
      environment: {
        ...mockReport.environment,
        requiredMissing: ['DATABASE_URL', 'API_KEY'],
      },
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, report: reportWithMissing }),
    });
    render(<SystemFunctionalAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/obligatoriska saknas/i)).toBeInTheDocument();
    });
  });
});
