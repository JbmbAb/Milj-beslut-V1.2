import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the lazy-loaded deferred sub-components so Suspense resolves immediately
vi.mock('../../components/applicationWizard/ApplicationWizardDeferredViews', () => ({
  LocationAuditStep: (props: {
    onBack: () => void;
    onRunAudit: () => void;
    latInput: string;
    lngInput: string;
  }) => (
    <div data-testid="location-audit-step">
      <span data-testid="lat-value">{props.latInput}</span>
      <button type="button" onClick={props.onBack}>
        Tillbaka
      </button>
      <button type="button" onClick={props.onRunAudit}>
        Kor audit
      </button>
    </div>
  ),
  RiskSummaryStep: (props: { onContinue: () => void; onChangeCoordinates: () => void }) => (
    <div data-testid="risk-summary-step">
      <button type="button" onClick={props.onContinue}>
        Fortsatt
      </button>
      <button type="button" onClick={props.onChangeCoordinates}>
        Andra koordinater
      </button>
    </div>
  ),
  ManualGateStep: () => <div data-testid="manual-gate-step" />,
}));

import ApplicationWizard from '../../components/ApplicationWizard';

describe('ApplicationWizard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Step indicator ──────────────────────────────────────────────────────────

  it('renders all 4 step titles in the progress bar', () => {
    render(<ApplicationWizard />);
    expect(screen.getByText('Identitet')).toBeInTheDocument();
    expect(screen.getByText('Plats')).toBeInTheDocument();
    expect(screen.getByText('Auditsvar')).toBeInTheDocument();
    expect(screen.getByText('Manuell grind')).toBeInTheDocument();
  });

  // ── Step 1 – initial render ─────────────────────────────────────────────────

  it('shows Identitet och ansvar heading on step 1', () => {
    render(<ApplicationWizard />);
    expect(screen.getByText('Identitet och ansvar')).toBeInTheDocument();
  });

  it('shows BankID-status label on step 1', () => {
    render(<ApplicationWizard />);
    expect(screen.getByText('BankID-status')).toBeInTheDocument();
  });

  it('shows Starta BankID button initially', () => {
    render(<ApplicationWizard />);
    expect(screen.getByRole('button', { name: /Starta BankID/i })).toBeInTheDocument();
  });

  it('shows Fortsatt manuell kontroll button on step 1', () => {
    render(<ApplicationWizard />);
    expect(screen.getByRole('button', { name: /Fortsatt manuell kontroll/i })).toBeInTheDocument();
  });

  // ── Step navigation ─────────────────────────────────────────────────────────

  it('advances to step 2 (LocationAuditStep) after clicking manual review', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ApplicationWizard />);
    await user.click(screen.getByRole('button', { name: /Fortsatt manuell kontroll/i }));
    expect(await screen.findByTestId('location-audit-step')).toBeInTheDocument();
  });

  it('returns to step 1 when back button is clicked on step 2', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ApplicationWizard />);
    await user.click(screen.getByRole('button', { name: /Fortsatt manuell kontroll/i }));
    await screen.findByTestId('location-audit-step');
    await user.click(screen.getByRole('button', { name: /Tillbaka/i }));
    expect(screen.getByText('Identitet och ansvar')).toBeInTheDocument();
  });

  // ── BankID error handling ───────────────────────────────────────────────────

  it('displays error message when BankID init fetch fails', async () => {
    const user = userEvent.setup({ delay: null });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('BankID kunde inte startas.')));
    render(<ApplicationWizard />);
    await user.click(screen.getByRole('button', { name: /Starta BankID/i }));
    await waitFor(() => expect(screen.getByText(/BankID kunde inte startas\./i)).toBeInTheDocument());
  });
});
