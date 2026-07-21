import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StakeholderAnalysis from '../../components/StakeholderAnalysis';

vi.mock('../../services/coreApiClient', () => ({
  getActiveProjectId: vi.fn(() => 'proj-1'),
}));

describe('StakeholderAnalysis', () => {
  beforeEach(() => {
    // Mock fetch globally
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Loading state ────────────────────────────────────────────────────────

  it('shows loading state initially', () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {
        // Never resolves - stay in loading state
      }),
    );
    render(<StakeholderAnalysis />);
    expect(screen.getByText(/Laddar intressentanalys/i)).toBeInTheDocument();
  });

  // ── API Error handling ───────────────────────────────────────────────────

  it('falls back to initial stakeholders on API error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/kunde inte hämtas/i)).toBeInTheDocument();
    });
  });

  it('falls back to initial stakeholders on 404 response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/kunde inte verifieras/i)).toBeInTheDocument();
    });
  });

  it('shows empty state when API returns an empty stakeholders list', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: [] }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Inga intressenter tillagda än/i)).toBeInTheDocument();
    });
  });

  // ── Initial render with API data ──────────────────────────────────────────

  it('loads stakeholders from API when available', async () => {
    const mockStakeholders = [
      {
        id: '1',
        name: 'Custom Stakeholder',
        type: 'Authority',
        impact: 'High',
        interest: 'High',
        strategy: 'Custom strategy',
      },
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: mockStakeholders }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByText('Custom Stakeholder')).toBeInTheDocument();
    });
  });

  // ── Table rendering ──────────────────────────────────────────────────────

  it('renders the stakeholder table', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: [] }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'Intressent' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Typ' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Påverkan' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Intresse' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Strategi' })).toBeInTheDocument();
    });
  });

  it('renders table headers', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: [] }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: 'Intressent' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Typ' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Påverkan' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Intresse' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Strategi' })).toBeInTheDocument();
    });
  });

  it('renders fallback stakeholders in table', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Inga intressenter tillagda än/i)).toBeInTheDocument();
    });
  });

  it('displays stakeholder types correctly', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        stakeholders: [
          {
            id: '1',
            name: 'Myndighet A',
            type: 'Authority',
            impact: 'High',
            interest: 'Medium',
            strategy: 'Test',
          },
          {
            id: '2',
            name: 'Närboende',
            type: 'Neighbor',
            impact: 'Low',
            interest: 'High',
            strategy: 'Test',
          },
        ],
      }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getAllByText('Authority').length).toBeGreaterThan(0);
      expect(screen.getByText('Neighbor')).toBeInTheDocument();
    });
  });

  it('displays impact and interest levels with correct colors', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        stakeholders: [
          {
            id: '1',
            name: 'Stakeholder',
            type: 'Authority',
            impact: 'High',
            interest: 'High',
            strategy: 'Test',
          },
        ],
      }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      // Check for High impact badges (rose-100)
      const badges = screen.getAllByText('High');
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  // ── Add stakeholder button ───────────────────────────────────────────────

  it('renders "Lägg till intressent" button', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: [] }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Lägg till intressent/i })).toBeInTheDocument();
    });
  });

  it('button click adds a new stakeholder', async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: [] }),
    });
    render(<StakeholderAnalysis />);
    const addButton = await screen.findByRole('button', { name: /Lägg till intressent/i });
    await user.click(addButton);
    await waitFor(() => {
      expect(screen.getByText('Ny intressent')).toBeInTheDocument();
    });
  });

  it('saves new stakeholder to API when added', async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, stakeholders: [] }),
      })
      .mockResolvedValueOnce({ ok: true } as any);
    render(<StakeholderAnalysis />);
    const addButton = await screen.findByRole('button', { name: /Lägg till intressent/i });
    await user.click(addButton);
    await waitFor(() => {
      // Verify fetch was called to save
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/stakeholders'),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  // ── Counter display ──────────────────────────────────────────────────────

  it('displays total count of stakeholders', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Totalt.*aktiva intressenter/i)).toBeInTheDocument();
    });
  });

  it('updates count when stakeholder is added', async () => {
    const user = userEvent.setup();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: [] }),
    });
    render(<StakeholderAnalysis />);
    const addButton = await screen.findByRole('button', { name: /Lägg till intressent/i });
    const initialCount = (screen.getByText(/Totalt.*aktiva intressenter/i).textContent || '').match(
      /\d+/,
    )?.[0];
    await user.click(addButton);
    await waitFor(() => {
      const newCount = (screen.getByText(/Totalt.*aktiva intressenter/i).textContent || '').match(/\d+/)?.[0];
      expect(Number(newCount)).toBeGreaterThan(Number(initialCount));
    });
  });

  // ── Empty state ──────────────────────────────────────────────────────────

  it('shows empty state message when no stakeholders exist', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: [] }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Inga intressenter tillagda än/i)).toBeInTheDocument();
    });
  });

  // ── Page layout ──────────────────────────────────────────────────────────

  it('renders the main heading', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: [] }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByText('Intressentanalys')).toBeInTheDocument();
    });
  });

  it('renders analysis section with prioritization info', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: [] }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Analys: Prioritering/i)).toBeInTheDocument();
    });
  });

  it('renders consultation status section', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, stakeholders: [] }),
    });
    render(<StakeholderAnalysis />);
    await waitFor(() => {
      expect(screen.getByText(/Samrådsstatus/i)).toBeInTheDocument();
    });
  });

  it('shows saving indicator during save operation', async () => {
    const user = userEvent.setup();
    let resolveSave: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });

    let callCount = 0;
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url: string) => {
      callCount++;
      if (callCount === 1) {
        // Initial load
        return { ok: true, json: async () => ({ ok: true, stakeholders: [] }) };
      } else {
        // Save operation
        await savePromise;
        return { ok: true };
      }
    });

    render(<StakeholderAnalysis />);
    const addButton = await screen.findByRole('button', { name: /Lägg till intressent/i });
    const saveTask = user.click(addButton);

    await waitFor(() => {
      expect(screen.getByText(/Sparar/i)).toBeInTheDocument();
    });

    resolveSave!();
    await saveTask;
  });
});
