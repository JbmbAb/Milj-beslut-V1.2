import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/workspacePreload', () => ({
  preloadWorkspaceForMode: vi.fn().mockResolvedValue(undefined),
}));

import WorkspaceScaffold from '../../components/WorkspaceScaffold';

const defaultProps = {
  mode: 'LOGISTICS_MARKET' as const,
  activeTab: 'archive',
  onSetActiveTab: vi.fn(),
  onOpenMode: vi.fn(),
  onExitToDashboard: vi.fn(),
  children: <div data-testid="workspace-content">Content</div>,
};

describe('WorkspaceScaffold', () => {
  // ── Sidebar structure ─────────────────────────────────────────────────────

  it('renders children content', () => {
    render(<WorkspaceScaffold {...defaultProps} />);
    expect(screen.getByTestId('workspace-content')).toBeInTheDocument();
  });

  it('renders sidebar navigation', () => {
    render(<WorkspaceScaffold {...defaultProps} />);
    expect(screen.getByText('Moduler')).toBeInTheDocument();
  });

  it('renders all mode titles in sidebar', () => {
    render(<WorkspaceScaffold {...defaultProps} />);
    expect(screen.getAllByText('Logistik schaktmassor').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Provningsportal').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Projektledning').length).toBeGreaterThanOrEqual(1);
  });

  it('renders API: Ansluten badge', () => {
    render(<WorkspaceScaffold {...defaultProps} />);
    expect(screen.getByText('API: Ansluten')).toBeInTheDocument();
  });

  it('renders Avsnitt section', () => {
    render(<WorkspaceScaffold {...defaultProps} />);
    expect(screen.getByText('Avsnitt')).toBeInTheDocument();
  });

  // ── Mode-specific sidebar links ────────────────────────────────────────────

  it('renders Logistik och massor link for LOGISTICS_MARKET mode', () => {
    render(<WorkspaceScaffold {...defaultProps} />);
    expect(screen.getByText('Logistik och massor')).toBeInTheDocument();
  });

  it('renders Beslutsarkiv link for LOGISTICS_MARKET mode', () => {
    render(<WorkspaceScaffold {...defaultProps} />);
    expect(screen.getByText('Beslutsarkiv')).toBeInTheDocument();
  });

  it('renders Ny ansokan link for PERMIT_PORTAL mode', () => {
    render(<WorkspaceScaffold {...defaultProps} mode="PERMIT_PORTAL" activeTab="map" />);
    expect(screen.getByText('Ny ansokan')).toBeInTheDocument();
  });

  it('renders Projektplan link for PROJECT_MANAGER mode', () => {
    render(<WorkspaceScaffold {...defaultProps} mode="PROJECT_MANAGER" activeTab="plan" />);
    expect(screen.getByText('Projektplan')).toBeInTheDocument();
  });

  // ── Interaction ────────────────────────────────────────────────────────────

  it('calls onOpenMode when mode button is clicked', () => {
    const onOpenMode = vi.fn();
    render(<WorkspaceScaffold {...defaultProps} onOpenMode={onOpenMode} />);
    // Click Provningsportal module button
    fireEvent.click(screen.getByText('Provningsportal'));
    expect(onOpenMode).toHaveBeenCalledWith('PERMIT_PORTAL');
  });

  it('calls onSetActiveTab when sidebar link is clicked', () => {
    const onSetActiveTab = vi.fn();
    render(<WorkspaceScaffold {...defaultProps} onSetActiveTab={onSetActiveTab} />);
    fireEvent.click(screen.getByText('Logistik och massor'));
    expect(onSetActiveTab).toHaveBeenCalledWith('logistics');
  });

  it('renders headerBadges when provided', () => {
    render(
      <WorkspaceScaffold {...defaultProps} headerBadges={<span data-testid="badge">Test Badge</span>} />,
    );
    expect(screen.getByTestId('badge')).toBeInTheDocument();
  });
});
