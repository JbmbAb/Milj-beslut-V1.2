import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProjectPlan } from '../../src/ui/hooks/useProjectPlan';

const projectMocks = vi.hoisted(() => ({
  applyTemplate: vi.fn(),
  calculateCarbon: vi.fn(),
  evaluateStageGate: vi.fn(),
  fetchProjectPlan: vi.fn(),
  saveProjectPlan: vi.fn(),
}));

vi.mock('../../src/ui/api-client/project.client', () => ({
  applyTemplate: projectMocks.applyTemplate,
  calculateCarbon: projectMocks.calculateCarbon,
  evaluateStageGate: projectMocks.evaluateStageGate,
  fetchProjectPlan: projectMocks.fetchProjectPlan,
  saveProjectPlan: projectMocks.saveProjectPlan,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  };
}

describe('src/ui/hooks/useProjectPlan', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not fetch without projectId and loads plans when present', async () => {
    const { Wrapper } = createWrapper();
    projectMocks.fetchProjectPlan.mockResolvedValue({ id: 'plan-1', name: 'Plan 1' });

    const disabled = renderHook(() => useProjectPlan(''), { wrapper: Wrapper });
    expect(disabled.result.current.isLoading).toBe(false);
    expect(projectMocks.fetchProjectPlan).not.toHaveBeenCalled();

    const enabled = renderHook(() => useProjectPlan('project-1'), { wrapper: Wrapper });
    await waitFor(() => {
      expect(enabled.result.current.plan).toEqual({ id: 'plan-1', name: 'Plan 1' });
    });
  });

  it('delegates save, template, gate and carbon mutations', async () => {
    const { Wrapper, queryClient } = createWrapper();
    const plan = { id: 'plan-1', name: 'Plan 1' } as any;

    projectMocks.fetchProjectPlan.mockResolvedValue(plan);
    projectMocks.saveProjectPlan.mockResolvedValue(undefined);
    projectMocks.applyTemplate.mockResolvedValue({ ...plan, template: 'A' });
    projectMocks.evaluateStageGate.mockResolvedValue({
      plan: { ...plan, passed: true },
      changed: true,
      status: 'PASSED',
    });
    projectMocks.calculateCarbon.mockResolvedValue({ ...plan, carbon: 42 });

    const { result } = renderHook(() => useProjectPlan('project-1'), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.plan).toEqual(plan);
    });

    await result.current.savePlan(plan);
    expect(projectMocks.saveProjectPlan).toHaveBeenCalledWith('project-1', plan);

    await result.current.applyTemplate({ templateId: 'A', plan });
    expect(queryClient.getQueryData(['projectPlan', 'project-1'])).toEqual({ ...plan, template: 'A' });

    await result.current.evaluateGate({ gateId: 'gate-1', context: { foo: 'bar' } });
    expect(queryClient.getQueryData(['projectPlan', 'project-1'])).toEqual({ ...plan, passed: true });

    await result.current.calculateCarbon({ carbonInput: { distance: 1 }, plan });
    expect(queryClient.getQueryData(['projectPlan', 'project-1'])).toEqual({ ...plan, carbon: 42 });
  });
});
