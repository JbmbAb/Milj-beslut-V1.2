import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../../components/core/coreDemoModel';

vi.mock('../../services/coreApiClient', () => ({
  callCore: vi.fn(),
}));

import CorePermitGeneratorView from '../../components/core/CorePermitGeneratorView';

const project: Project = {
  id: 'p-001',
  propertyDesignation: 'Malmo Industri 2:7',
  status: 'ACTIVE',
  docCount: 8,
  coverage: { municipality: 75, decisionType: 60 },
};

describe('CorePermitGeneratorView', () => {
  it('renders the form heading', () => {
    render(<CorePermitGeneratorView project={project} />);
    expect(screen.getByText('Underlag C-anmälan')).toBeInTheDocument();
  });

  it('renders all five editable input fields', () => {
    render(<CorePermitGeneratorView project={project} />);
    expect(screen.getByText('Verksamhetsutövare')).toBeInTheDocument();
    expect(screen.getByText('Kommun')).toBeInTheDocument();
    expect(screen.getByText('Fastighet')).toBeInTheDocument();
    expect(screen.getByText('EWC-kod')).toBeInTheDocument();
    expect(screen.getByText('Volym (ton)')).toBeInTheDocument();
  });

  it('pre-fills property designation from project', () => {
    render(<CorePermitGeneratorView project={project} />);
    expect(screen.getByDisplayValue('Malmo Industri 2:7')).toBeInTheDocument();
  });

  it('pre-fills EWC-kod default 17 05 04', () => {
    render(<CorePermitGeneratorView project={project} />);
    expect(screen.getByDisplayValue('17 05 04')).toBeInTheDocument();
  });

  it('renders the generate button', () => {
    render(<CorePermitGeneratorView project={project} />);
    expect(screen.getByRole('button', { name: /Generera C-anmälan/i })).toBeInTheDocument();
  });

  it('generate button is not disabled initially', () => {
    render(<CorePermitGeneratorView project={project} />);
    expect(screen.getByRole('button', { name: /Generera C-anmälan/i })).not.toBeDisabled();
  });

  it('shows empty state placeholder before generation', () => {
    render(<CorePermitGeneratorView project={project} />);
    expect(screen.getByText(/Ingen genererad data/i)).toBeInTheDocument();
  });
});
