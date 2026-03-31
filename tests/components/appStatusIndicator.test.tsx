import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AppStatusIndicator from '../../components/admin/AppStatusIndicator';
import type { AppStatusResponse } from '../../types';

const okStatus: AppStatusResponse = {
  checkedAt: '2024-06-01T12:00:00.000Z',
  overall: 'ok',
  app: { status: 'ok', version: '1.2.3', uptimeSeconds: 7200, environment: 'production' },
  db: { status: 'ok', latencyMs: 5 },
  datasources: { total: 6, connected: 6, errors: 0, permitRequired: 1, allOpenSourcesActive: true },
};

const degradedStatus: AppStatusResponse = {
  ...okStatus,
  overall: 'degraded',
  db: { status: 'ok', latencyMs: 250 },
  datasources: { ...okStatus.datasources, connected: 4, errors: 2 },
};

const errorStatus: AppStatusResponse = {
  ...okStatus,
  overall: 'error',
  db: { status: 'error', latencyMs: null },
};

describe('AppStatusIndicator', () => {
  it('renders nothing when hasActiveSession is false', () => {
    const { container } = render(<AppStatusIndicator appStatus={okStatus} hasActiveSession={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows loading text when appStatus is null', () => {
    render(<AppStatusIndicator appStatus={null} hasActiveSession />);
    expect(screen.getByText('Kontrollerar appstatus…')).toBeInTheDocument();
  });

  it('shows "Appen är igång" when overall is ok', () => {
    render(<AppStatusIndicator appStatus={okStatus} hasActiveSession />);
    expect(screen.getByText('Appen är igång')).toBeInTheDocument();
  });

  it('shows "Appen är igång (degraderad)" when overall is degraded', () => {
    render(<AppStatusIndicator appStatus={degradedStatus} hasActiveSession />);
    expect(screen.getByText('Appen är igång (degraderad)')).toBeInTheDocument();
  });

  it('shows "Appen har fel" when overall is error', () => {
    render(<AppStatusIndicator appStatus={errorStatus} hasActiveSession />);
    expect(screen.getByText('Appen har fel')).toBeInTheDocument();
  });

  it('shows DB latency when status is ok', () => {
    render(<AppStatusIndicator appStatus={okStatus} hasActiveSession />);
    expect(screen.getByText(/5 ms/)).toBeInTheDocument();
  });

  it('renders the status bar element', () => {
    render(<AppStatusIndicator appStatus={okStatus} hasActiveSession />);
    expect(screen.getByTestId('app-status-bar')).toBeInTheDocument();
  });

  it('shows datasource counts', () => {
    render(<AppStatusIndicator appStatus={okStatus} hasActiveSession />);
    expect(screen.getByText(/6\/6/)).toBeInTheDocument();
  });
});
