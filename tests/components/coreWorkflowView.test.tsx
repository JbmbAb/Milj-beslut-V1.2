import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreWorkflowView } from '../../components/CoreWorkflowView';

const project = {
  id: 'project-1',
  propertyDesignation: 'Haninge 1:1',
  status: 'ACTIVE',
  docCount: 4,
  coverage: {
    municipality: 92,
    decisionType: 88,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CoreWorkflowView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders branding headline and dashboard heading', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ projects: [] })),
    );

    render(<CoreWorkflowView />);

    expect(screen.getByText(/Miljöbeslut\.se/i)).toBeInTheDocument();
    expect(await screen.findByText('Mina Projekt')).toBeInTheDocument();
  });

  it('renders nav tabs and keeps search/classify/generate disabled before project selection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ projects: [] })),
    );

    render(<CoreWorkflowView />);

    expect(await screen.findByText('Projekt')).toBeInTheDocument();
    const searchButton = screen.getByRole('button', { name: /Sök kunskap/i });
    const classifyButton = screen.getByRole('button', { name: /AI Klassificering/i });
    const generateButton = screen.getByRole('button', { name: /C-anmälan/i });

    expect(searchButton).toBeDisabled();
    expect(classifyButton).toBeDisabled();
    expect(generateButton).toBeDisabled();
  });

  it('renders projects from the API and activates workflow after project selection', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/v1/projects')) {
        return jsonResponse({ projects: [project] });
      }
      if (url.includes('/api/v1/municipality/Haninge/insight')) {
        return jsonResponse({
          insight: {
            name: 'Haninge',
            index: 78,
            ranking: 12,
            commonRisks: ['Dagvatten'],
            commonRequirements: ['Trafikplan'],
            stats: {
              avgRequirements: 14,
              riskCoveragePct: 81,
              documentationLevel: 'HÖG',
            },
            patterns: ['Vattenskydd'],
          },
        });
      }
      if (url.includes('/api/v1/projects/project-1/search')) {
        return jsonResponse({
          results: [
            {
              id: 'search-1',
              originalName: 'Riskutredning',
              subject: 'Lakvatten',
              municipality: 'Haninge',
              decisionType: 'Anmälan',
              snippet: 'Lakvatten ska samlas upp.',
              score: 0.9,
            },
          ],
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CoreWorkflowView />);

    expect(await screen.findByText('Haninge 1:1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Haninge 1:1'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sök kunskap/i })).not.toBeDisabled();
    });

    expect(screen.getByText('Aktivt Projekt')).toBeInTheDocument();
    expect(screen.getByText('Haninge 1:1')).toBeInTheDocument();
    expect(await screen.findByText(/Tillsynsindex: Haninge/i)).toBeInTheDocument();
  });

  it('returns to the dashboard when cancel is clicked', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/v1/projects')) {
        return jsonResponse({ projects: [project] });
      }
      if (url.includes('/api/v1/municipality/Haninge/insight')) {
        return jsonResponse({
          insight: {
            name: 'Haninge',
            index: 78,
            ranking: 12,
            commonRisks: ['Dagvatten'],
            commonRequirements: ['Trafikplan'],
            stats: {
              avgRequirements: 14,
              riskCoveragePct: 81,
              documentationLevel: 'HÖG',
            },
            patterns: ['Vattenskydd'],
          },
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CoreWorkflowView />);

    fireEvent.click(await screen.findByText('Haninge 1:1'));
    await screen.findByText(/Tillsynsindex: Haninge/i);

    fireEvent.click(screen.getByTitle('Avbryt projekt'));

    await waitFor(() => {
      expect(screen.queryByText('Aktivt Projekt')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Miljöbeslut\.se/i)).toBeInTheDocument();
    expect(screen.getByText('Mina Projekt')).toBeInTheDocument();
  });
});
