import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FormManager from '../../components/FormManager';

describe('FormManager', () => {
  it('renders the heading', () => {
    render(<FormManager />);
    expect(screen.getByText('Blankett-hantering')).toBeInTheDocument();
  });

  it('shows the blocked state heading', () => {
    render(<FormManager />);
    expect(screen.getByText('Ingen verifierad blankettmall tillgänglig')).toBeInTheDocument();
  });

  it('shows the requirements for re-activation', () => {
    render(<FormManager />);
    expect(screen.getByText(/Verifierad formulärkälla/i)).toBeInTheDocument();
    expect(screen.getByText(/Spårbar versionshantering/i)).toBeInTheDocument();
    expect(screen.getByText(/Human-in-the-loop/i)).toBeInTheDocument();
  });

  it('shows the blocked label', () => {
    render(<FormManager />);
    expect(screen.getByText(/Blankettmotor blockerad/i)).toBeInTheDocument();
  });

  it('does not render any form inputs (no fake data)', () => {
    const { container } = render(<FormManager />);
    const inputs = container.querySelectorAll('input, select, textarea');
    expect(inputs.length).toBe(0);
  });
});
