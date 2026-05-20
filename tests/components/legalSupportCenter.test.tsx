import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LegalSupportCenter from '../../components/LegalSupportCenter';

describe('LegalSupportCenter', () => {
  // ── Section headings ────────────────────────────────────────────────────────

  it('renders the main heading', () => {
    render(<LegalSupportCenter />);
    expect(screen.getByText(/GDPR, kontakt och integrerad hjälp/)).toBeInTheDocument();
  });

  it('renders the subtitle section label', () => {
    render(<LegalSupportCenter />);
    expect(screen.getByText(/Juridik och support/i)).toBeInTheDocument();
  });

  // ── Legal blocks ────────────────────────────────────────────────────────────

  it('renders all four legal block titles', () => {
    render(<LegalSupportCenter />);
    expect(screen.getByText('GDPR och rättslig grund')).toBeInTheDocument();
    expect(screen.getByText('Registrerades rättigheter')).toBeInTheDocument();
    expect(screen.getByText('Säkerhet och incidenthantering')).toBeInTheDocument();
    expect(screen.getByText('Cookies och spårning')).toBeInTheDocument();
  });

  it('renders GDPR legal block items', () => {
    render(<LegalSupportCenter />);
    expect(screen.getByText(/Personuppgifter behandlas för avtal/)).toBeInTheDocument();
    expect(screen.getByText(/Dataminimering/)).toBeInTheDocument();
  });

  it('renders security block items', () => {
    render(<LegalSupportCenter />);
    expect(screen.getByText(/Åtkomst styrs via token/)).toBeInTheDocument();
  });

  it('renders cookie block items', () => {
    render(<LegalSupportCenter />);
    expect(screen.getByText(/Nödvändiga cookies/)).toBeInTheDocument();
  });

  // ── Help topics ─────────────────────────────────────────────────────────────

  it('renders help topics section', () => {
    render(<LegalSupportCenter />);
    expect(screen.getByText(/Inloggning och behörighet/)).toBeInTheDocument();
    expect(screen.getByText(/Export, rapportering och audit/)).toBeInTheDocument();
    expect(screen.getByText(/Juridik, GDPR/)).toBeInTheDocument();
  });

  // ── Contact info ────────────────────────────────────────────────────────────

  it('renders contact email', () => {
    render(<LegalSupportCenter />);
    expect(screen.getByText(/support@miljobeslut\.se/)).toBeInTheDocument();
  });

  it('renders company name', () => {
    render(<LegalSupportCenter />);
    expect(screen.getByText(/Miljöbeslut\.se/)).toBeInTheDocument();
  });
});
