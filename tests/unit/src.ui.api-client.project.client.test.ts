import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTemplate,
  calculateCarbon,
  evaluateStageGate,
  fetchProjectPlan,
  saveProjectPlan,
} from '../../src/ui/api-client/project.client';

describe('src/ui/api-client/project.client', () => {
  const plan = { id: 'plan-1', name: 'Plan' } as any;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches project plans and surfaces API errors', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plan }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'missing plan' }),
      }) as unknown as typeof fetch;

    await expect(fetchProjectPlan('project-1')).resolves.toEqual(plan);
    await expect(fetchProjectPlan('project-2')).rejects.toThrow('missing plan');
  });

  it('saves plans and throws when save fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'save failed' }),
      }) as unknown as typeof fetch;

    await expect(saveProjectPlan('project-1', plan)).resolves.toBeUndefined();
    await expect(saveProjectPlan('project-1', plan)).rejects.toThrow('save failed');
  });

  it('applies templates, evaluates gates and calculates carbon', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plan: { ...plan, template: 't-1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plan: { ...plan, gate: true }, changed: true, gate: { status: 'PASSED' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plan: { ...plan, carbon: 42 } }),
      }) as unknown as typeof fetch;

    await expect(applyTemplate('project-1', 'template-1', plan)).resolves.toEqual({
      ...plan,
      template: 't-1',
    });
    await expect(evaluateStageGate('project-1', 'gate-1', { foo: 'bar' })).resolves.toEqual({
      plan: { ...plan, gate: true },
      changed: true,
      status: 'PASSED',
    });
    await expect(calculateCarbon('project-1', { distance: 1 }, plan)).resolves.toEqual({
      ...plan,
      carbon: 42,
    });
  });
});
