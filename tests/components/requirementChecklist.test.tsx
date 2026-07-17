import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import RequirementChecklist from '../../components/RequirementChecklist';
import type { WasteCode } from '../../types';

const baseCode: WasteCode = {
  code: '19 12 12',
  name: 'Övrigt avfall',
  type: 'EWC',
  requirements: {
    storageTime: 'Max 1 år',
    maxAmount: '100 ton',
    safetyDistance: '10 meter',
    legalReference: 'MB 15 kap. 3 §',
  },
};

describe('RequirementChecklist', () => {
  it('renders the heading', () => {
    render(<RequirementChecklist code={baseCode} />);
    expect(screen.getByText(/Checklista för regelefterlevnad/i)).toBeInTheDocument();
  });

  it('renders Lagringstid row with value', () => {
    render(<RequirementChecklist code={baseCode} />);
    expect(screen.getByText('Lagringstid')).toBeInTheDocument();
    expect(screen.getByText('Max 1 år')).toBeInTheDocument();
  });

  it('renders Maxmängd row with value', () => {
    render(<RequirementChecklist code={baseCode} />);
    expect(screen.getByText('Maxmängd')).toBeInTheDocument();
    expect(screen.getByText('100 ton')).toBeInTheDocument();
  });

  it('renders Skyddsavstånd row with value', () => {
    render(<RequirementChecklist code={baseCode} />);
    expect(screen.getByText('Skyddsavstånd')).toBeInTheDocument();
    expect(screen.getByText('10 meter')).toBeInTheDocument();
  });

  it('shows legalReference badge', () => {
    render(<RequirementChecklist code={baseCode} />);
    expect(screen.getAllByText('MB 15 kap. 3 §').length).toBeGreaterThan(0);
  });

  it('renders fallback storageTime when not provided', () => {
    const code = { ...baseCode, requirements: { ...baseCode.requirements, storageTime: undefined } };
    render(<RequirementChecklist code={code} />);
    expect(screen.getByText(/Saknas i verifierad kravdata/i)).toBeInTheDocument();
  });

  it('renders fallback maxAmount when not provided', () => {
    const code = { ...baseCode, requirements: { ...baseCode.requirements, maxAmount: undefined } };
    render(<RequirementChecklist code={code} />);
    expect(screen.getByText(/Saknas i verifierad kravdata/i)).toBeInTheDocument();
  });

  it('renders extra citations passed as props', () => {
    const citations = [
      {
        id: 'c1',
        quoteText: 'Citat om transport',
        sourceType: 'Transport',
        legalReference: 'MB 9 kap.',
      },
    ];
    render(<RequirementChecklist code={baseCode} citations={citations} />);
    expect(screen.getByText('Transport')).toBeInTheDocument();
  });

  it('shows tooltip on hover over Lagringstid', async () => {
    render(<RequirementChecklist code={baseCode} />);
    const row = screen.getByText('Lagringstid').closest('.group') as HTMLElement;
    await userEvent.hover(row);
    expect(screen.getByRole('heading', { level: 4, name: /KÄLLHÄNVISNING/i })).toBeInTheDocument();
  });

  it('hides tooltip after mouseleave', async () => {
    render(<RequirementChecklist code={baseCode} />);
    const row = screen.getByText('Lagringstid').closest('.group') as HTMLElement;
    await userEvent.hover(row);
    await userEvent.unhover(row);
    expect(screen.queryByText(/KÄLLHÄNVISNING/i)).not.toBeInTheDocument();
  });
});
