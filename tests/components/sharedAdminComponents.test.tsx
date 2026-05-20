import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiCard, StatusBanner } from '../../components/admin/SharedAdminComponents';

describe('KpiCard', () => {
  it('renders label and value', () => {
    render(<KpiCard label="Täckning" value="87%" />);
    expect(screen.getByText('Täckning')).toBeInTheDocument();
    expect(screen.getByText('87%')).toBeInTheDocument();
  });

  it('renders label in uppercase style container', () => {
    render(<KpiCard label="Dokument" value="42" />);
    const label = screen.getByText('Dokument');
    expect(label.tagName).toBe('P');
  });
});

describe('StatusBanner', () => {
  it('renders nothing when neither error nor info is provided', () => {
    const { container } = render(<StatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders error message', () => {
    render(<StatusBanner error="Anslutningsfel" />);
    expect(screen.getByTestId('admin-status-error')).toHaveTextContent('Anslutningsfel');
  });

  it('renders info message', () => {
    render(<StatusBanner info="Allt klart" />);
    expect(screen.getByTestId('admin-status-info')).toHaveTextContent('Allt klart');
  });

  it('renders both error and info when both provided', () => {
    render(<StatusBanner error="Fel!" info="Se log" />);
    expect(screen.getByTestId('admin-status-error')).toBeInTheDocument();
    expect(screen.getByTestId('admin-status-info')).toBeInTheDocument();
  });

  it('renders the status banner container', () => {
    render(<StatusBanner info="Klar" />);
    expect(screen.getByTestId('admin-status-banner')).toBeInTheDocument();
  });
});
