import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PropertyRegisterExtract from '../../components/PropertyRegisterExtract';

describe('PropertyRegisterExtract', () => {
  it('shows no-selection state when propertyId is empty', () => {
    render(<PropertyRegisterExtract propertyId="" />);
    expect(screen.getByText('Ingen verifierad fastighet vald')).toBeInTheDocument();
  });

  it('shows no-selection state when propertyId is whitespace only', () => {
    render(<PropertyRegisterExtract propertyId="   " />);
    expect(screen.getByText('Ingen verifierad fastighet vald')).toBeInTheDocument();
  });

  it('shows live-utdrag-ej-aktiverat state for valid propertyId', () => {
    render(<PropertyRegisterExtract propertyId="AB1234" />);
    expect(screen.getByText('Live-utdrag ej aktiverat')).toBeInTheDocument();
  });

  it('displays the propertyId in the active state', () => {
    render(<PropertyRegisterExtract propertyId="SE-12345" />);
    expect(screen.getByText('SE-12345')).toBeInTheDocument();
  });

  it('shows requirements list in active state', () => {
    render(<PropertyRegisterExtract propertyId="XYZ" />);
    expect(screen.getByText(/Verifierad live-route/i)).toBeInTheDocument();
    expect(screen.getByText(/kallhanvisning/i)).toBeInTheDocument();
  });

  it('does not show live-utdrag section when propertyId is empty', () => {
    render(<PropertyRegisterExtract propertyId="" />);
    expect(screen.queryByText('Live-utdrag ej aktiverat')).not.toBeInTheDocument();
  });
});
