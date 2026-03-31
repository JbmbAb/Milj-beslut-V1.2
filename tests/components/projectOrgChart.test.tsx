import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ProjectOrgChart from '../../components/ProjectOrgChart';

const user = userEvent.setup({ delay: null });

describe('ProjectOrgChart', () => {
  // ── Initial render ──────────────────────────────────────────────────────────

  it('renders the heading "Organisationsplan"', () => {
    render(<ProjectOrgChart />);
    expect(screen.getByText('Organisationsplan')).toBeInTheDocument();
  });

  it('renders Styrgrupp node', () => {
    render(<ProjectOrgChart />);
    expect(screen.getByDisplayValue('Styrgrupp')).toBeInTheDocument();
  });

  it('renders Projektledare node', () => {
    render(<ProjectOrgChart />);
    expect(screen.getByDisplayValue('Projektledare')).toBeInTheDocument();
  });

  it('renders partner nodes (Markägare, Entreprenör, Miljökonsult)', () => {
    render(<ProjectOrgChart />);
    expect(screen.getByDisplayValue('Markägare')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Entreprenör')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Miljökonsult')).toBeInTheDocument();
  });

  it('renders role labels', () => {
    render(<ProjectOrgChart />);
    expect(screen.getByDisplayValue('Beslutsfattare')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Operativt ansvar')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Intressent')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Tekniskt stöd')).toBeInTheDocument();
  });

  // ── Inline editing ──────────────────────────────────────────────────────────

  it('shows editable inputs for node title and role', () => {
    render(<ProjectOrgChart />);
    // Each node renders an input for title
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThanOrEqual(5);
  });

  it('updates a node title when edited', async () => {
    render(<ProjectOrgChart />);
    const titleInputs = screen.getAllByRole('textbox');
    // The first textbox should be the first node's title
    await user.clear(titleInputs[0]);
    await user.type(titleInputs[0], 'Ny Styrgrupp');
    expect((titleInputs[0] as HTMLInputElement).value).toBe('Ny Styrgrupp');
  });
});
