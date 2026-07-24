import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the lazy-loaded deferred sub-components so Suspense resolves immediately
vi.mock('../../components/applicationWizard/ApplicationWizardDeferredViews', () => ({
  LocationAuditStep: (props: { onBack: () => void; onContinue: () => void; wizardState: any }) => (
    <div data-testid="location-audit-step">
      <span data-testid="lat-value">{props.wizardState.lat}</span>
      <button type="button" onClick={props.onBack}>
        Tillbaka
      </button>
      <button type="button" onClick={props.onContinue}>
        Fortsätt
      </button>
    </div>
  ),
  RiskSummaryStep: (props: { onReset: () => void; onBack: () => void }) => (
    <div data-testid="risk-summary-step">
      <button type="button" onClick={props.onBack}>
        Tillbaka
      </button>
      <button type="button" onClick={props.onReset}>
        Börja om
      </button>
    </div>
  ),
}));

// Mock MapView inside tests since Leaflet references window objects that might fail in jsdom
vi.mock('../MapView', () => ({
  default: () => <div data-testid="mock-map-view" />,
}));

import ApplicationWizard from '../../components/ApplicationWizard';

describe('ApplicationWizard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Step indicator ──────────────────────────────────────────────────────────

  it('renders all 3 step titles in the progress bar', () => {
    render(<ApplicationWizard />);
    expect(screen.getByText('Grunduppgifter')).toBeInTheDocument();
    expect(screen.getByText('Karta & Analys')).toBeInTheDocument();
    expect(screen.getByText('Sammanställning')).toBeInTheDocument();
  });

  // ── Step 1 – initial render ─────────────────────────────────────────────────

  it('shows Skapa Ansökningsunderlag heading on step 1', () => {
    render(<ApplicationWizard />);
    expect(screen.getByText('Skapa Ansökningsunderlag')).toBeInTheDocument();
  });

  it('shows Identitetskontroll (BankID) label on step 1', () => {
    render(<ApplicationWizard />);
    expect(screen.getByText('Identitetskontroll (BankID)')).toBeInTheDocument();
  });

  it('shows Starta BankID button initially', () => {
    render(<ApplicationWizard />);
    expect(screen.getByRole('button', { name: /Starta BankID/i })).toBeInTheDocument();
  });

  it('shows Fortsatt manuell kontroll button on step 1', () => {
    render(<ApplicationWizard />);
    expect(screen.getByRole('button', { name: /Fortsätt manuell kontroll/i })).toBeInTheDocument();
  });

  // ── Step navigation ─────────────────────────────────────────────────────────

  it('allows manual review and entering property search to advance to step 2', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ApplicationWizard />);

    // Click Manual review to unlock search
    await user.click(screen.getByRole('button', { name: /Fortsätt manuell kontroll/i }));

    // Check that property search is now visible
    const searchInput = screen.getByPlaceholderText(/T.ex. Länna 1:45/i);
    expect(searchInput).toBeInTheDocument();

    // Type property and search
    await user.type(searchInput, 'Länna 1:45');
    await user.click(screen.getByRole('button', { name: 'Sök' }));

    // Verify search was successful
    expect(screen.getByText(/Träff: Länna 1:45 i Haninge kommun/i)).toBeInTheDocument();

    // Now proceed button should be active. Click it to advance to Step 2
    await user.click(screen.getByRole('button', { name: /Fortsätt till karta & analys/i }));

    // Wait and verify we arrived at Step 2
    expect(
      await screen.findByTestId('location-audit-step', undefined, { timeout: 15000 }),
    ).toBeInTheDocument();
  }, 15000);

  it('returns to step 1 when back button is clicked on step 2', async () => {
    const user = userEvent.setup({ delay: null });
    render(<ApplicationWizard />);

    await user.click(screen.getByRole('button', { name: /Fortsätt manuell kontroll/i }));
    const searchInput = screen.getByPlaceholderText(/T.ex. Länna 1:45/i);
    await user.type(searchInput, 'Länna 1:45');
    await user.click(screen.getByRole('button', { name: 'Sök' }));

    await user.click(screen.getByRole('button', { name: /Fortsätt till karta & analys/i }));
    await screen.findByTestId('location-audit-step', undefined, { timeout: 15000 });

    await user.click(screen.getByRole('button', { name: /Tillbaka/i }));
    expect(screen.getByText('Skapa Ansökningsunderlag')).toBeInTheDocument();
  }, 15000);

  // ── BankID error handling ───────────────────────────────────────────────────

  it('displays error message when BankID init fetch fails', async () => {
    const user = userEvent.setup({ delay: null });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('BankID kunde inte startas.')));
    render(<ApplicationWizard />);
    await user.click(screen.getByRole('button', { name: /Starta BankID/i }));
    await waitFor(() => expect(screen.getByText(/BankID kunde inte startas\./i)).toBeInTheDocument());
  });
});
