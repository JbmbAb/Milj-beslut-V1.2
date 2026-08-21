import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DetailModal from '../../components/DetailModal';
import type { Permit } from '../../types';
import { DecisionType } from '../../types';

describe('DetailModal', () => {
  const mockPermit: Permit = {
    id: '1',
    filename: 'permit.pdf',
    checksum: 'abc123def456',
    received_date: '2026-04-03',
    property_id: 'CASE-001',
    municipality: 'Test Municipality',
    waste_codes: '17 01 01',
    decision_type: DecisionType.BIFALL,
    full_text: 'Test full text',
    processed_at: new Date().toISOString(),
    applicant_company: 'Test Applicant',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render modal when open', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} onOpenLegalSupport={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should display permit details', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} onOpenLegalSupport={vi.fn()} />);
    expect(screen.getByText('CASE-001')).toBeInTheDocument();
  });

  it('should call onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<DetailModal permit={mockPermit} onClose={onClose} onOpenLegalSupport={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    // The first button in the header is the close button
    fireEvent.click(buttons[0]);

    expect(onClose).toHaveBeenCalled();
  });

  it('should display applicant information', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} onOpenLegalSupport={vi.fn()} />);
    expect(screen.getByText('Test Applicant')).toBeInTheDocument();
  });

  it('should display municipality information', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} onOpenLegalSupport={vi.fn()} />);
    expect(screen.getAllByText(/Test Municipality/i)[0]).toBeInTheDocument();
  });

  it('should display permit status', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} onOpenLegalSupport={vi.fn()} />);
    expect(screen.getByText('Officiellt Beslut')).toBeInTheDocument();
  });

  it('should update when data changes', () => {
    const { rerender } = render(<DetailModal permit={mockPermit} onClose={vi.fn()} onOpenLegalSupport={vi.fn()} />);

    const newData: Permit = {
      ...mockPermit,
      property_id: 'CASE-002',
    };

    rerender(<DetailModal permit={newData} onClose={vi.fn()} onOpenLegalSupport={vi.fn()} />);

    expect(screen.getByText('CASE-002')).toBeInTheDocument();
  });

  it('should display action buttons', () => {
    render(<DetailModal permit={mockPermit} onClose={vi.fn()} onOpenLegalSupport={vi.fn()} />);
    // Check if the "STARTA ANALYS" button is present as an example of an action button
    expect(screen.getByText(/STARTA ANALYS/i)).toBeInTheDocument();
  });
});
