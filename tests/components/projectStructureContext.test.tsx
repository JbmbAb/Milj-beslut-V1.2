import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectStructureProvider, useProjectStructure } from '../../components/ProjectStructureContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal consumer component that calls the hook and exposes values via DOM. */
const Consumer: React.FC = () => {
  const { plan, updatePlan, addArchiveDocument } = useProjectStructure();
  return (
    <div>
      <span data-testid="project-name">{plan.name}</span>
      <span data-testid="archive-count">{plan.documentArchive.length}</span>
      <span data-testid="project-type">{plan.projectType}</span>
      <button type="button" onClick={() => updatePlan('name', 'Nytt projektnamn')}>
        Byt namn
      </button>
      <button
        type="button"
        onClick={() =>
          addArchiveDocument({
            name: 'Test-dokument',
            module: 'PERMIT_PORTAL',
            category: 'PERMIT',
          })
        }
      >
        Lagg till dokument
      </button>
    </div>
  );
};

/** Consumer with two distinct add-document buttons for the deduplication tests. */
const TwoDocConsumer: React.FC = () => {
  const { plan, addArchiveDocument } = useProjectStructure();
  return (
    <div>
      <span data-testid="archive-count">{plan.documentArchive.length}</span>
      <button
        type="button"
        onClick={() =>
          addArchiveDocument({ name: 'Dokument A', module: 'PERMIT_PORTAL', category: 'PERMIT' })
        }
      >
        Lagg till A
      </button>
      <button
        type="button"
        onClick={() =>
          addArchiveDocument({ name: 'Dokument B', module: 'PERMIT_PORTAL', category: 'PERMIT' })
        }
      >
        Lagg till B
      </button>
    </div>
  );
};

const ThrowingConsumer: React.FC = () => {
  useProjectStructure(); // should throw when no provider
  return null;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProjectStructureProvider / useProjectStructure', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  // ── Provider renders children ───────────────────────────────────────────────

  it('renders children inside the provider', () => {
    render(
      <ProjectStructureProvider>
        <div data-testid="child">barn</div>
      </ProjectStructureProvider>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  // ── Initial state ───────────────────────────────────────────────────────────

  it('provides a default projectName', () => {
    render(
      <ProjectStructureProvider>
        <Consumer />
      </ProjectStructureProvider>,
    );
    // The default is set by createDefaultProjectPlan – just verify it's a string
    expect(screen.getByTestId('project-name').textContent).toBeDefined();
  });

  it('provides an empty archive by default', () => {
    render(
      <ProjectStructureProvider>
        <Consumer />
      </ProjectStructureProvider>,
    );
    expect(screen.getByTestId('archive-count').textContent).toBe('0');
  });

  it('provides a default projectType', () => {
    render(
      <ProjectStructureProvider>
        <Consumer />
      </ProjectStructureProvider>,
    );
    const projectType = screen.getByTestId('project-type').textContent;
    expect(projectType).toBeTruthy();
  });

  // ── updatePlan ──────────────────────────────────────────────────────────────

  it('updatePlan updates projectName in state', async () => {
    const { getByRole } = render(
      <ProjectStructureProvider>
        <Consumer />
      </ProjectStructureProvider>,
    );

    await act(async () => {
      getByRole('button', { name: /Byt namn/i }).click();
    });

    expect(screen.getByTestId('project-name').textContent).toBe('Nytt projektnamn');
  });

  // ── addArchiveDocument ──────────────────────────────────────────────────────

  it('addArchiveDocument increments archive count', async () => {
    const { getByRole } = render(
      <ProjectStructureProvider>
        <Consumer />
      </ProjectStructureProvider>,
    );

    expect(screen.getByTestId('archive-count').textContent).toBe('0');

    await act(async () => {
      getByRole('button', { name: /Lagg till dokument/i }).click();
    });

    expect(screen.getByTestId('archive-count').textContent).toBe('1');
  });

  it('addArchiveDocument twice with distinct names results in count 2', async () => {
    const { getByRole } = render(
      <ProjectStructureProvider>
        <TwoDocConsumer />
      </ProjectStructureProvider>,
    );

    await act(async () => {
      getByRole('button', { name: /Lagg till A/i }).click();
    });
    await act(async () => {
      getByRole('button', { name: /Lagg till B/i }).click();
    });

    expect(screen.getByTestId('archive-count').textContent).toBe('2');
  });

  // ── Persisting to localStorage ──────────────────────────────────────────────

  it('updates state without writing legacy localStorage when no remote session is active', async () => {
    const { getByRole } = render(
      <ProjectStructureProvider>
        <Consumer />
      </ProjectStructureProvider>,
    );

    await act(async () => {
      getByRole('button', { name: /Byt namn/i }).click();
    });

    expect(screen.getByTestId('project-name').textContent).toBe('Nytt projektnamn');
    const stored = localStorage.getItem('miljobeslut_project_structure_v2');
    expect(stored).toBeNull();
  });

  // ── useProjectStructure outside provider ────────────────────────────────────

  it('throws when useProjectStructure is used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ThrowingConsumer />)).toThrow(
      'useProjectStructure must be used within a ProjectStructureProvider',
    );
    spy.mockRestore();
  });
});
