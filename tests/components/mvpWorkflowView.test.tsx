import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MvpWorkflowView from '../../components/MvpWorkflowView';

describe('MvpWorkflowView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Header ─────────────────────────────────────────────────────────────────

  it('renders the main heading', () => {
    render(<MvpWorkflowView />);
    expect(screen.getByText(/MVP.*Ansokningsflodet|MVP.*Ansökningsflöde/i)).toBeInTheDocument();
  });

  it('renders Projektdata section heading', () => {
    render(<MvpWorkflowView />);
    expect(screen.getByText(/Projektdata/i)).toBeInTheDocument();
  });

  // ── Input fields ───────────────────────────────────────────────────────────

  it('renders EWC-kod label', () => {
    render(<MvpWorkflowView />);
    expect(screen.getByText('EWC-kod')).toBeInTheDocument();
  });

  it('renders EWC input with default value 17 05 04', () => {
    render(<MvpWorkflowView />);
    expect(screen.getByDisplayValue('17 05 04')).toBeInTheDocument();
  });

  it('renders Volym (ton) label', () => {
    render(<MvpWorkflowView />);
    expect(screen.getByText('Volym (ton)')).toBeInTheDocument();
  });

  it('renders Plats/Adress input', () => {
    render(<MvpWorkflowView />);
    expect(screen.getByText('Plats/Adress')).toBeInTheDocument();
  });

  it('renders Kommun input with default Göteborg', () => {
    render(<MvpWorkflowView />);
    const inputs = screen.getAllByDisplayValue('Göteborg');
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  // ── Run button ─────────────────────────────────────────────────────────────

  it('renders the start workflow button', () => {
    render(<MvpWorkflowView />);
    expect(screen.getByRole('button', { name: /Starta komplett/i })).toBeInTheDocument();
  });

  it('the workflow button is not disabled initially', () => {
    render(<MvpWorkflowView />);
    const btn = screen.getByRole('button', { name: /Starta komplett/i });
    expect(btn).not.toBeDisabled();
  });

  // ── Step cards ─────────────────────────────────────────────────────────────

  it('renders all 7 workflow step cards', () => {
    render(<MvpWorkflowView />);
    expect(screen.getByText('Klassifiera verksamhet')).toBeInTheDocument();
    expect(screen.getByText('Hämta juridiska krav')).toBeInTheDocument();
    expect(screen.getByText('Riskanalys')).toBeInTheDocument();
    expect(screen.getByText('Labbdatavalidering')).toBeInTheDocument();
    expect(screen.getByText(/Generera ansokningsutkast|Generera ansökningsutkast/i)).toBeInTheDocument();
    expect(screen.getByText(/Verifiera juridiska citat/i)).toBeInTheDocument();
    expect(screen.getByText(/Exportera dokument/i)).toBeInTheDocument();
  });

  it('shows step 1 endpoint', () => {
    render(<MvpWorkflowView />);
    expect(screen.getByText('/api/v1/classification/activity')).toBeInTheDocument();
  });
});
