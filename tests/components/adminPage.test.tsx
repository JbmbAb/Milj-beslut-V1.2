import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminPage from '../../components/AdminPage';

// Mock AdminContainer to avoid rendering complex child components
vi.mock('../../components/admin/AdminContainer', () => ({
  default: () => <div data-testid="admin-container">Admin Container Mocked</div>,
}));

describe('AdminPage', () => {
  it('renders successfully', () => {
    render(<AdminPage />);
    expect(screen.getByTestId('admin-container')).toBeInTheDocument();
  });

  it('renders the AdminContainer component', () => {
    const { container } = render(<AdminPage />);
    expect(container.querySelector('[data-testid="admin-container"]')).toBeInTheDocument();
  });

  it('is a functional React component', () => {
    const { container } = render(<AdminPage />);
    expect(container.firstChild).toBeTruthy();
  });
});
