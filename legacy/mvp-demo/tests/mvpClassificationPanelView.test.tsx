import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Classification, Project } from '../../components/mvp/mvpDemoModel';

vi.mock('../../services/mvpApiClient', () => ({
  callMvp: vi.fn(),
}));

import { callMvp } from '../../services/mvpApiClient';
import MvpClassificationPanelView from '../../components/mvp/MvpClassificationPanelView';

const project: Project = {
  id: 'p-001',
  propertyDesignation: 'Uppsala Gard 4:1',
  status: 'ACTIVE',
  docCount: 6,
  coverage: { municipality: 90, decisionType: 70 },
};

const classificationResult: Classification = {
  classification: 'C-anmälan',
  riskLevel: 'LOW',
  suggestedCode: '90.02',
  confidence: 0.87,
  missingFields: [],
  citations: [{ source: 'beslut-001', snippet: 'Verksamheten...', municipality: 'Uppsala' }],
};

describe('MvpClassificationPanelView', () => {
  it('renders AI-Klassificering heading', () => {
    render(<MvpClassificationPanelView project={project} />);
    expect(screen.getByText('AI-Klassificering')).toBeInTheDocument();
  });

  it('renders the run classification button', () => {
    render(<MvpClassificationPanelView project={project} />);
    expect(screen.getByRole('button', { name: /Kör Klassificering/i })).toBeInTheDocument();
  });

  it('run button is enabled initially', () => {
    render(<MvpClassificationPanelView project={project} />);
    expect(screen.getByRole('button', { name: /Kör Klassificering/i })).not.toBeDisabled();
  });

  it('shows classification result after successful run', async () => {
    vi.mocked(callMvp).mockResolvedValueOnce(classificationResult);
    render(<MvpClassificationPanelView project={project} />);
    fireEvent.click(screen.getByRole('button', { name: /Kör Klassificering/i }));
    await waitFor(() => {
      expect(screen.getByText('C-anmälan')).toBeInTheDocument();
    });
  });

  it('shows suggested code after successful run', async () => {
    vi.mocked(callMvp).mockResolvedValueOnce(classificationResult);
    render(<MvpClassificationPanelView project={project} />);
    fireEvent.click(screen.getByRole('button', { name: /Kör Klassificering/i }));
    await waitFor(() => {
      expect(screen.getByText('90.02')).toBeInTheDocument();
    });
  });

  it('shows confidence percentage after run', async () => {
    vi.mocked(callMvp).mockResolvedValueOnce(classificationResult);
    render(<MvpClassificationPanelView project={project} />);
    fireEvent.click(screen.getByRole('button', { name: /Kör Klassificering/i }));
    await waitFor(() => {
      expect(screen.getByText('87%')).toBeInTheDocument();
    });
  });

  it('hides run button after classification completes', async () => {
    vi.mocked(callMvp).mockResolvedValueOnce(classificationResult);
    render(<MvpClassificationPanelView project={project} />);
    fireEvent.click(screen.getByRole('button', { name: /Kör Klassificering/i }));
    await waitFor(() => screen.getByText('C-anmälan'));
    expect(screen.queryByRole('button', { name: /Kör Klassificering/i })).not.toBeInTheDocument();
  });
});
