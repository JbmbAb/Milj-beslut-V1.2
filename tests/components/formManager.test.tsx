import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FormManager from '../../components/FormManager';

describe('FormManager', () => {
  it('renders the heading', () => {
    render(<FormManager />);
    expect(screen.getByText(/Blankett-hantering\./i)).toBeInTheDocument();
  });

  it('shows the draft state heading', () => {
    render(<FormManager />);
    expect(screen.getByText(/UTKAST - EJ VERIFIERAT/i)).toBeInTheDocument();
  });

  it('shows the core section headings', () => {
    render(<FormManager />);
    expect(screen.getByText(/Verksamhetsutövare/i)).toBeInTheDocument();
    expect(screen.getByText(/Platsbeskrivning/i)).toBeInTheDocument();
    expect(screen.getByText(/Teknisk Beskrivning/i)).toBeInTheDocument();
  });

  it('shows the manual mode label', () => {
    render(<FormManager />);
    expect(screen.getByText(/Manuellt läge aktivt/i)).toBeInTheDocument();
  });

  it('renders form inputs for manual completion', () => {
    const { container } = render(<FormManager />);
    const inputs = container.querySelectorAll('input, select, textarea');
    expect(inputs.length).toBeGreaterThan(0);
  });
});
