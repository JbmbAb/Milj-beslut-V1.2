import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdminMetadataReview from '../../components/AdminMetadataReview';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminMetadataReview', () => {
  it('shows loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<AdminMetadataReview />);
    expect(screen.getByText(/Laddar granskningskö/i)).toBeInTheDocument();
  });

  it('shows error message on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('network'));
    render(<AdminMetadataReview />);
    await waitFor(() => {
      expect(screen.getByText(/Nätverksfel vid hämtning/i)).toBeInTheDocument();
    });
  });

  it('shows error message on 401 response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ ok: false }),
    });
    render(<AdminMetadataReview />);
    await waitFor(() => {
      expect(screen.getByText(/Adminsessionen har gått ut/i)).toBeInTheDocument();
    });
  });

  it('shows empty-queue state when queue is empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, queue: [] }),
    });
    render(<AdminMetadataReview />);
    await waitFor(() => {
      expect(screen.getByText('Kön är tom')).toBeInTheDocument();
    });
  });

  it('renders heading after successful load', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, queue: [] }),
    });
    render(<AdminMetadataReview />);
    await waitFor(() => {
      expect(screen.getByText(/Kvalitetssäkring av metadata/i)).toBeInTheDocument();
    });
  });

  it('displays queue items after load', async () => {
    const item = {
      id: 'r1',
      documentId: 'd1',
      queueType: 'LOW_CONFIDENCE',
      fieldName: 'activityCode',
      proposedValue: null,
      confidence: 0.4,
      reason: 'Low confidence extraction',
      createdAt: '2024-01-15T10:00:00.000Z',
      document: {
        id: 'd1',
        subject: 'Ansökan om muddringstillstånd',
        absolutePath: '/docs/d1.pdf',
        municipalityNormalized: 'Stockholm',
        legalStatus: null,
        decisionType: null,
        activityCode: null,
        wasteType: null,
      },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, queue: [item] }),
    });
    render(<AdminMetadataReview />);
    await waitFor(() => {
      expect(screen.getByText('Ansökan om muddringstillstånd')).toBeInTheDocument();
    });
    // exact match to avoid matching the description sentence "...låg tillförlitlighet..."
    expect(screen.getByText('Låg tillförlitlighet')).toBeInTheDocument();
  });

  it('shows 1 ärenden count in header', async () => {
    const item = {
      id: 'r2',
      documentId: 'd2',
      queueType: 'DISAGREEMENT',
      fieldName: 'legalStatus',
      proposedValue: 'MB',
      confidence: null,
      reason: 'Disagreement between models',
      createdAt: '2024-02-01T08:00:00.000Z',
      document: {
        id: 'd2',
        subject: 'Beslut om deponering',
        absolutePath: '/docs/d2.pdf',
        municipalityNormalized: 'Göteborg',
        legalStatus: null,
        decisionType: null,
        activityCode: null,
        wasteType: null,
      },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, queue: [item] }),
    });
    render(<AdminMetadataReview />);
    await waitFor(() => {
      expect(screen.getByText(/1 ärenden väntar på granskning/i)).toBeInTheDocument();
    });
  });

  it('shows DISAGREEMENT badge for conflict items', async () => {
    const item = {
      id: 'r3',
      documentId: 'd3',
      queueType: 'DISAGREEMENT',
      fieldName: 'decisionType',
      proposedValue: 'BIFALL',
      confidence: null,
      reason: 'Conflict',
      createdAt: '2024-03-01T09:00:00.000Z',
      document: {
        id: 'd3',
        subject: 'Konfliktbeslut',
        absolutePath: '/docs/d3.pdf',
        municipalityNormalized: null,
        legalStatus: null,
        decisionType: null,
        activityCode: null,
        wasteType: null,
      },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, queue: [item] }),
    });
    render(<AdminMetadataReview />);
    await waitFor(() => {
      expect(screen.getByText('Konflikt')).toBeInTheDocument();
    });
  });
});
