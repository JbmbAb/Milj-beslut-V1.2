import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectPicker } from '../../components/app/ProjectPicker';
import type { AppBootstrapProjectSummary } from '../../src/types/app';

function project(id: string, propertyDesignation: string): AppBootstrapProjectSummary {
  return {
    id,
    propertyDesignation,
    status: 'ACTIVE',
    createdAt: '2026-04-02T00:00:00.000Z',
    complianceScore: null,
    environmentalScore: null,
    fundingRating: null,
    regulatoryRiskScore: null,
    documentCount: 0,
    memberCount: 1,
    lastPlanUpdatedAt: null,
  };
}

describe('ProjectPicker', () => {
  it('0 projects -> honest empty state, no picker', () => {
    render(<ProjectPicker projects={[]} activeProjectId={null} onSelect={vi.fn()} />);

    expect(screen.getByTestId('project-picker-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('project-picker')).not.toBeInTheDocument();
  });

  it('1 project -> renders nothing (automatic normal entry, no switcher needed)', () => {
    const { container } = render(
      <ProjectPicker projects={[project('p1', 'Demo 1:1')]} activeProjectId="p1" onSelect={vi.fn()} />,
    );

    expect(screen.queryByTestId('project-picker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('project-picker-empty')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('>1 projects -> shows a minimal picker containing only the given (server-authorized) projects', () => {
    const projects = [project('p1', 'Demo 1:1'), project('p2', 'Demo 2:2')];
    render(<ProjectPicker projects={projects} activeProjectId="p1" onSelect={vi.fn()} />);

    const select = screen.getByTestId('project-picker-select');
    expect(select).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('Demo 1:1 (ACTIVE)')).toBeInTheDocument();
    expect(screen.getByText('Demo 2:2 (ACTIVE)')).toBeInTheDocument();
  });

  it('selecting a project calls onSelect with that project id only (server remains authority on the next fetch)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const projects = [project('p1', 'Demo 1:1'), project('p2', 'Demo 2:2')];
    render(<ProjectPicker projects={projects} activeProjectId="p1" onSelect={onSelect} />);

    await user.selectOptions(screen.getByTestId('project-picker-select'), 'p2');

    expect(onSelect).toHaveBeenCalledWith('p2');
    expect(onSelect).not.toHaveBeenCalledWith('some-forged-id-not-in-projects');
  });
});
