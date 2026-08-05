import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MimerProductShell } from '../../components/app/MimerProductShell';

vi.mock('@miljobeslut/mps-compass', () => ({
  MpsCompass: () => <div data-testid="mps-compass" />,
}));

vi.mock('@miljobeslut/mps-identity', () => ({
  designTokens: {
    colors: {
      surfaceDarkStone: { hex: '#1C1C1E' },
      coreTurquoise: { hex: '#40E0D0' },
      flowLightCyan: { hex: '#E0FFFF' },
      coreGraphite: { hex: '#2C2C2E' },
      statusAudit: { hex: '#F0E68C' },
    },
  },
}));

vi.mock('@miljobeslut/mps-console', () => ({
  MpsConsoleApp: () => <div data-testid="mps-console-stub">Console</div>,
}));

vi.mock('../../components/app/lu/LuWorkspace', () => ({
  LuWorkspace: () => <div data-testid="lu-workspace" />,
}));

describe('MimerProductShell', () => {
  it('shows only LU and admin in nav', () => {
    render(<MimerProductShell />);
    expect(screen.getByTestId('nav-localization')).toBeInTheDocument();
    expect(screen.getByTestId('nav-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-sewage')).not.toBeInTheDocument();
  });

  it('opens LuWorkspace for localization (not LocalizationStudyUI)', async () => {
    const user = userEvent.setup();
    render(<MimerProductShell userName="Test User" />);
    await user.click(screen.getByTestId('nav-localization'));
    expect(screen.getByTestId('product-localization')).toBeInTheDocument();
    expect(screen.getByTestId('lu-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('localization-study-ui')).not.toBeInTheDocument();
  });

  it('opens admin console from home quick link', async () => {
    const user = userEvent.setup();
    render(<MimerProductShell />);
    await user.click(screen.getByTestId('home-open-admin'));
    expect(screen.getByTestId('product-admin')).toBeInTheDocument();
  });
});
