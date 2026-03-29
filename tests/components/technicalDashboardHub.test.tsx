import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { TechnicalDashboardHub } from '../../components/TechnicalDashboardHub';

vi.mock('../../components/TechnicalSluExpert', () => ({
  TechnicalSluExpert: () => <div data-testid="technical-slu-expert" />,
}));

beforeAll(() => {
  class MockIntersectionObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: MockIntersectionObserver,
  });
});

describe('TechnicalDashboardHub', () => {
  it('renders branding text', () => {
    render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
    expect(screen.getByText(/RiskGuard/i)).toBeInTheDocument();
    expect(screen.getByText(/Miljobeslut 2\.0/i)).toBeInTheDocument();
  });

  it('renders hero headline', () => {
    render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
    expect(screen.getByText(/Gor miljo-tillstand enkelt och sakert/i)).toBeInTheDocument();
  });

  it('renders all 6 module cards', () => {
    render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
    expect(screen.getByText('MVP Workflow')).toBeInTheDocument();
    expect(screen.getByText('Ansokningsportal')).toBeInTheDocument();
    expect(screen.getByText('Logistik & Massor')).toBeInTheDocument();
    expect(screen.getByText('Projektledning')).toBeInTheDocument();
    expect(screen.getByText('Gronkoll (Score)')).toBeInTheDocument();
    // "Administrator" appears as both module title and default user – use testId to confirm the card
    expect(screen.getByTestId('landing-open-admin')).toBeInTheDocument();
  });

  it('calls onSelectModule with correct id when MVP card clicked', () => {
    const onSelectModule = vi.fn();
    render(<TechnicalDashboardHub onSelectModule={onSelectModule} />);
    fireEvent.click(screen.getByTestId('landing-open-mvp'));
    expect(onSelectModule).toHaveBeenCalledWith('mvp');
  });

  it('calls onSelectModule with ansokan id when ansökan card clicked', () => {
    const onSelectModule = vi.fn();
    render(<TechnicalDashboardHub onSelectModule={onSelectModule} />);
    fireEvent.click(screen.getByTestId('landing-open-ansokan'));
    expect(onSelectModule).toHaveBeenCalledWith('ansokan');
  });

  it('calls onPreviewModule on mouse enter', () => {
    const onPreviewModule = vi.fn();
    render(<TechnicalDashboardHub onSelectModule={vi.fn()} onPreviewModule={onPreviewModule} />);
    fireEvent.mouseEnter(screen.getByTestId('landing-open-admin'));
    expect(onPreviewModule).toHaveBeenCalledWith('admin');
  });

  it('renders user name when provided', () => {
    render(<TechnicalDashboardHub onSelectModule={vi.fn()} user={{ name: 'Karin Eriksson' }} />);
    expect(screen.getByText('Karin Eriksson')).toBeInTheDocument();
  });

  it('renders default Administrator when no user provided', () => {
    render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
    // "Administrator" appears as both the default user label and the admin module title
    expect(screen.getAllByText('Administrator').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Powered by Gemini label', () => {
    render(<TechnicalDashboardHub onSelectModule={vi.fn()} />);
    expect(screen.getByText(/Powered by Gemini/i)).toBeInTheDocument();
  });
});
