import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminAuthPanel from '../../components/admin/AdminAuthPanel';
import type { AdminProjectSummary } from '../../types';

const projects: AdminProjectSummary[] = [
  {
    id: 'proj-1',
    propertyDesignation: 'Stadsäng 1:1',
    status: 'ACTIVE',
    createdAt: '2024-01-01T00:00:00.000Z',
    organisation: { id: 'org-1', name: 'Testbolaget AB', orgNumber: '556000-0001' },
    _count: { documents: 3, members: 2, accessLogs: 5 },
  },
];

const baseProps = {
  username: '',
  setUsername: vi.fn(),
  password: '',
  setPassword: vi.fn(),
  token: '',
  refreshToken: '',
  projectId: '',
  setProjectId: vi.fn(),
  newProjectDesignation: '',
  setNewProjectDesignation: vi.fn(),
  projects: [],
  busy: '',
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  loadProjects: vi.fn(),
  createProject: vi.fn(),
  loadMapAndDataStatus: vi.fn(),
  loadExternalHealth: vi.fn(),
  loadExamSummary: vi.fn(),
  loadDatabaseDump: vi.fn(),
};

describe('AdminAuthPanel', () => {
  it('renders the section heading', () => {
    render(<AdminAuthPanel {...baseProps} />);
    expect(screen.getByText('Admin inloggning och session')).toBeInTheDocument();
  });

  it('renders username and password inputs', () => {
    render(<AdminAuthPanel {...baseProps} />);
    expect(screen.getByTestId('admin-username-input')).toBeInTheDocument();
    expect(screen.getByTestId('admin-password-input')).toBeInTheDocument();
  });

  it('renders Logga in button and calls login on click', () => {
    const login = vi.fn();
    render(<AdminAuthPanel {...baseProps} login={login} />);
    const btn = screen.getByTestId('admin-login-button');
    fireEvent.click(btn);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('shows Arbetar... on login button when busy=login', () => {
    render(<AdminAuthPanel {...baseProps} busy="login" />);
    expect(screen.getByTestId('admin-login-button')).toHaveTextContent('Arbetar...');
  });

  it('disables all action buttons when busy and no token', () => {
    render(<AdminAuthPanel {...baseProps} busy="projects" />);
    const loginBtn = screen.getByTestId('admin-login-button');
    expect(loginBtn).toBeDisabled();
  });

  it('renders Logga ut button and calls logout on click', () => {
    const logout = vi.fn();
    render(<AdminAuthPanel {...baseProps} logout={logout} />);
    const btn = screen.getByRole('button', { name: 'Logga ut' });
    fireEvent.click(btn);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('renders project dropdown with projects list', () => {
    render(<AdminAuthPanel {...baseProps} projects={projects} />);
    const select = screen.getByTestId('admin-project-select');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Stadsäng 1:1 (Testbolaget AB)')).toBeInTheDocument();
  });

  it('calls setUsername when username input changes', () => {
    const setUsername = vi.fn();
    render(<AdminAuthPanel {...baseProps} setUsername={setUsername} />);
    fireEvent.change(screen.getByTestId('admin-username-input'), { target: { value: 'admin' } });
    expect(setUsername).toHaveBeenCalledWith('admin');
  });
});
