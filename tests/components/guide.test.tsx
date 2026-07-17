import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Guide from '../../components/Guide';
import { ProjectStructureProvider } from '../../components/ProjectStructureContext';

// Wrap Guide in the provider so useProjectStructure context is available
const renderGuide = (props: React.ComponentProps<typeof Guide> = {}) =>
  render(
    <ProjectStructureProvider>
      <Guide {...props} />
    </ProjectStructureProvider>,
  );

const user = userEvent.setup({ delay: null });

describe('Guide', () => {
  // ── Static heading ─────────────────────────────────────────────────────────

  it('renders main heading', () => {
    renderGuide();
    expect(screen.getByText(/Guide for nasta steg/i)).toBeInTheDocument();
  });

  it('renders Prioriterade atgarder section', () => {
    renderGuide();
    expect(screen.getByText(/Prioriterade atgarder/i)).toBeInTheDocument();
  });

  it('renders Arbetsordning section', () => {
    renderGuide();
    expect(screen.getByText(/Arbetsordning for beslutsunderlag/i)).toBeInTheDocument();
  });

  // ── Activate DB-session card appears in default state ─────────────────────

  it('shows Aktivera DB-session action when no remote session', () => {
    renderGuide();
    expect(screen.getByText('Aktivera DB-session')).toBeInTheDocument();
  });

  // ── Gate status card always present ──────────────────────────────────────

  it('renders a gate-status action card', () => {
    renderGuide();
    // Either "Los blockerade stage-gates" or "Gate-status ar stabil"
    const gateCard =
      screen.queryByText(/Los blockerade stage-gates/i) || screen.queryByText(/Gate-status ar stabil/i);
    expect(gateCard).not.toBeNull();
  });

  // ── Navigation via onNavigate prop ────────────────────────────────────────

  it('calls onNavigate when an action card button is clicked', async () => {
    const onNavigate = vi.fn();
    renderGuide({ onNavigate });
    // Action card buttons are labeled "Oppna <tab>"
    const openBtns = screen.getAllByRole('button', { name: /Oppna/i });
    expect(openBtns.length).toBeGreaterThan(0);
    await user.click(openBtns[0]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  // ── Mode variations ───────────────────────────────────────────────────────

  it('renders without crashing for PROJECT_MANAGER mode', () => {
    renderGuide({ mode: 'PROJECT_MANAGER' });
    expect(screen.getByText(/Guide for nasta steg/i)).toBeInTheDocument();
  });

  it('renders without crashing for PERMIT_PORTAL mode', () => {
    renderGuide({ mode: 'PERMIT_PORTAL' });
    expect(screen.getByText(/Guide for nasta steg/i)).toBeInTheDocument();
  });

  it('renders without crashing for COMPLIANCE_AUDIT mode', () => {
    renderGuide({ mode: 'COMPLIANCE_AUDIT' });
    expect(screen.getByText(/Guide for nasta steg/i)).toBeInTheDocument();
  });
});
