/**
 * permitTable.test.tsx
 *
 * Testar PermitTable-komponenten:
 *   - Renderar tillståndsdata
 *   - Visar sökfält
 *   - Filtrerar resultat baserat på sökterm
 *   - Anropar onSelect vid klick på ett tillstånd
 *   - Visar kommunnamn i tabellen
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import PermitTable from '../../components/PermitTable';
import { DecisionType } from '../../types';
import type { Permit } from '../../types';

vi.mock('../../services/geminiService', () => ({
  generateMarketingSummary: vi.fn().mockResolvedValue({ text: 'Sammanfattning', sources: [] }),
}));

const SAMPLE_PERMITS: Permit[] = [
  {
    id: 'permit-1',
    filename: 'beslut_stockholm.pdf',
    checksum: 'abc1',
    received_date: '2024-01-10',
    property_id: 'Sthlm 1:1',
    municipality: 'Stockholm',
    waste_codes: '01 01 01',
    decision_type: DecisionType.BIFALL,
    full_text: 'Tillstånd beviljat för Stockholm.',
    processed_at: '2024-01-15',
    applicant_company: 'Sthlm Bygg AB',
  },
  {
    id: 'permit-2',
    filename: 'beslut_goteborg.pdf',
    checksum: 'abc2',
    received_date: '2024-02-10',
    property_id: 'Gbg 2:2',
    municipality: 'Göteborg',
    waste_codes: '02 01 01',
    decision_type: DecisionType.AVSLAG,
    full_text: 'Tillstånd avslaget för Göteborg.',
    processed_at: '2024-02-15',
    applicant_company: 'Gbg Mark AB',
  },
];

describe('PermitTable', () => {
  let onSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSelect = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderar sökandebolagets namn i tabellen', () => {
    render(<PermitTable permits={SAMPLE_PERMITS} onSelect={onSelect} />);
    expect(screen.getByText(/Sthlm Bygg AB/i)).toBeInTheDocument();
  });

  it('visar sökfält', () => {
    render(<PermitTable permits={SAMPLE_PERMITS} onSelect={onSelect} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  it('filtrerar resultat baserat på sökterm (applicant)', async () => {
    const user = userEvent.setup();
    render(<PermitTable permits={SAMPLE_PERMITS} onSelect={onSelect} />);

    const input = screen.getAllByRole('textbox')[0];
    await user.type(input, 'Sthlm Bygg');

    await waitFor(() => {
      expect(screen.getByText(/Sthlm Bygg AB/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Gbg Mark AB/i)).not.toBeInTheDocument();
  });

  it('anropar onSelect vid klick på ett permit', async () => {
    const user = userEvent.setup();
    render(<PermitTable permits={SAMPLE_PERMITS} onSelect={onSelect} />);

    const permitRow = screen.getByText(/Sthlm Bygg AB/i);
    await user.click(permitRow);

    expect(onSelect).toHaveBeenCalledWith(SAMPLE_PERMITS[0]);
  });

  it('visar kommunnamn för tillstånden', () => {
    render(<PermitTable permits={SAMPLE_PERMITS} onSelect={onSelect} />);
    expect(screen.getAllByText(/Stockholm/i).length).toBeGreaterThanOrEqual(1);
  });
});
