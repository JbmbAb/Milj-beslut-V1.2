import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../../components/core/coreDemoModel';

vi.mock('../../services/coreApiClient', () => ({
  callCore: vi.fn(),
}));

import { callCore } from '../../services/coreApiClient';
import ProjectDashboardView from '../../components/core/CoreProjectDashboardView';

const mockProjects: Project[] = [
  {
    id: 'p-001',
    propertyDesignation: 'Stockholm Brann 1:5',
    status: 'ACTIVE',
    docCount: 12,
    coverage: { municipality: 80, decisionType: 65 },
  },
  {
    id: 'p-002',
    propertyDesignation: 'Goteborg Hamn 3:2',
    status: 'ARCHIVED',
    docCount: 4,
    coverage: { municipality: 50, decisionType: 30 },
  },
];

describe('CoreProjectDashboardView', () => {
  it('shows loading state initially', () => {
    vi.mocked(callCore).mockReturnValue(new Promise(() => {}));
    render(<ProjectDashboardView onSelect={vi.fn()} />);
    expect(screen.getByText(/Laddar projekt/i)).toBeInTheDocument();
  });

  it('renders project cards after loading', async () => {
    vi.mocked(callCore).mockResolvedValueOnce({ projects: mockProjects });
    render(<ProjectDashboardView onSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Stockholm Brann 1:5')).toBeInTheDocument();
    });
  });

  it('renders second project card', async () => {
    vi.mocked(callCore).mockResolvedValueOnce({ projects: mockProjects });
    render(<ProjectDashboardView onSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Goteborg Hamn 3:2')).toBeInTheDocument();
    });
  });

  it('renders Mina Projekt heading after load', async () => {
    vi.mocked(callCore).mockResolvedValueOnce({ projects: mockProjects });
    render(<ProjectDashboardView onSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Mina Projekt')).toBeInTheDocument();
    });
  });

  it('renders empty project list when API returns none', async () => {
    vi.mocked(callCore).mockResolvedValueOnce({ projects: [] });
    render(<ProjectDashboardView onSelect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Mina Projekt')).toBeInTheDocument();
    });
    expect(screen.queryByText('Stockholm Brann 1:5')).not.toBeInTheDocument();
  });

  it('renders search input', async () => {
    vi.mocked(callCore).mockResolvedValueOnce({ projects: mockProjects });
    render(<ProjectDashboardView onSelect={vi.fn()} />);
    await waitFor(() => screen.getByText('Mina Projekt'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders disabled new project button', async () => {
    vi.mocked(callCore).mockResolvedValueOnce({ projects: mockProjects });
    render(<ProjectDashboardView onSelect={vi.fn()} />);
    await waitFor(() => screen.getByText('Mina Projekt'));
    const btn = screen.getByRole('button', { name: /Nytt projekt/i });
    expect(btn).toBeDisabled();
  });

  it('calls onSelect when a project card is clicked', async () => {
    vi.mocked(callCore).mockResolvedValueOnce({ projects: mockProjects });
    const onSelect = vi.fn();
    render(<ProjectDashboardView onSelect={onSelect} />);
    await waitFor(() => screen.getByText('Stockholm Brann 1:5'));
    screen.getByText('Stockholm Brann 1:5').closest('div')?.click();
    expect(onSelect).toHaveBeenCalled();
  });
});
