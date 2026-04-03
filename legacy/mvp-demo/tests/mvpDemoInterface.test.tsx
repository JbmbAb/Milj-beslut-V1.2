import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MvpDemoInterface } from '../../components/MvpDemoInterface';

vi.mock('../../components/mvp/MvpProjectDashboardView', () => ({
  default: ({ onSelect }: { onSelect: (p: unknown) => void }) => (
    <div data-testid="project-dashboard">
      <button onClick={() => onSelect({ id: 'p1', propertyDesignation: 'Testfastighet 1:1' })}>
        Välj projekt
      </button>
    </div>
  ),
}));

vi.mock('../../components/mvp/MvpDocumentSearchView', () => ({
  default: () => <div data-testid="document-search-view">DocumentSearch</div>,
}));

vi.mock('../../components/mvp/MvpClassificationPanelView', () => ({
  default: () => <div data-testid="classification-view">ClassificationView</div>,
}));

vi.mock('../../components/mvp/MvpPermitGeneratorView', () => ({
  default: () => <div data-testid="permit-generator-view">PermitGeneratorView</div>,
}));

vi.mock('../../components/mvp/MvpMunicipalityInsightPanel', () => ({
  default: () => <div data-testid="municipality-insight">MunicipalityInsight</div>,
}));

describe('MvpDemoInterface', () => {
  it('renders branding headline', () => {
    render(<MvpDemoInterface />);
    expect(screen.getByText(/Miljöbeslut\.se/i)).toBeInTheDocument();
  });

  it('renders nav tabs', () => {
    render(<MvpDemoInterface />);
    expect(screen.getByText('Projekt')).toBeInTheDocument();
    expect(screen.getByText('Sök kunskap')).toBeInTheDocument();
    expect(screen.getByText('AI Klassificering')).toBeInTheDocument();
    expect(screen.getByText('C-anmälan')).toBeInTheDocument();
  });

  it('shows project dashboard by default', async () => {
    render(<MvpDemoInterface />);
    expect(await screen.findByTestId('project-dashboard')).toBeInTheDocument();
  });

  it('search/classify/generate tabs are disabled initially', () => {
    render(<MvpDemoInterface />);
    const sokBtn = screen.getByText('Sök kunskap').closest('button');
    const klassBtn = screen.getByText('AI Klassificering').closest('button');
    const genBtn = screen.getByText('C-anmälan').closest('button');
    expect(sokBtn).toBeDisabled();
    expect(klassBtn).toBeDisabled();
    expect(genBtn).toBeDisabled();
  });

  it('projekt tab is enabled initially', () => {
    render(<MvpDemoInterface />);
    const projektBtn = screen.getByText('Projekt').closest('button');
    expect(projektBtn).not.toBeDisabled();
  });

  it('activates search tab after project is selected', async () => {
    render(<MvpDemoInterface />);
    const valjBtn = await screen.findByText('Välj projekt');
    fireEvent.click(valjBtn);
    const sokBtn = screen.getByText('Sök kunskap').closest('button');
    expect(sokBtn).not.toBeDisabled();
  });

  it('shows active project name after project selection', async () => {
    render(<MvpDemoInterface />);
    const valjBtn = await screen.findByText('Välj projekt');
    fireEvent.click(valjBtn);
    expect(screen.getByText('Testfastighet 1:1')).toBeInTheDocument();
  });

  it('resets to dashboard when cancel is clicked', async () => {
    render(<MvpDemoInterface />);
    const valjBtn = await screen.findByText('Välj projekt');
    fireEvent.click(valjBtn);
    // Cancel button (AlertTriangle) appears after project selected
    const cancelBtn = screen.getByTitle('Avbryt projekt');
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('Testfastighet 1:1')).not.toBeInTheDocument();
    expect(screen.getByText(/Miljöbeslut\.se/i)).toBeInTheDocument();
  });
});
