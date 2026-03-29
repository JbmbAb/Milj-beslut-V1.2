import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdminRequirementsStudio from '../../components/AdminRequirementsStudio';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  // Default: resolve with empty ok response so effects don't hang
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ ok: true, rows: [], total: 0, cases: [], summary: null }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const renderStudio = (token = 'test-token') =>
  render(
    <AdminRequirementsStudio
      token={token}
      onError={vi.fn()}
      onInfo={vi.fn()}
    />
  );

describe('AdminRequirementsStudio', () => {
  it('renders studio heading', () => {
    renderStudio();
    expect(screen.getByText(/Examensrapport Studio/i)).toBeInTheDocument();
  });

  it('renders sub-heading text', () => {
    renderStudio();
    expect(screen.getByText(/Verifieringsko, dokumentvisning och rapportexport/i)).toBeInTheDocument();
  });

  it('renders human-in-the-loop notice', () => {
    renderStudio();
    expect(screen.getByText(/Human-in-the-loop/i)).toBeInTheDocument();
  });

  it('renders VERIFIED-only warning badge', () => {
    renderStudio();
    expect(screen.getByText(/Rapportresultat bygger endast pa VERIFIED/i)).toBeInTheDocument();
  });

  it('renders status filter dropdown with ALL option', () => {
    renderStudio();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Alla statusar')).toBeInTheDocument();
  });

  it('renders filter inputs for Kommun, Kategori, Dokumenttyp, Verifierad av', () => {
    renderStudio();
    expect(screen.getByPlaceholderText('Kommun')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Kategori')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Dokumenttyp')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Verifierad av')).toBeInTheDocument();
  });

  it('changes status filter when option selected', () => {
    renderStudio();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'VERIFIED' } });
    expect(select.value).toBe('VERIFIED');
  });

  it('renders with empty token without crashing', () => {
    renderStudio('');
    expect(screen.getByText(/Examensrapport Studio/i)).toBeInTheDocument();
  });
});
