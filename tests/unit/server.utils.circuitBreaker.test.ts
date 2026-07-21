import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker } from '../../server/utils/circuitBreaker';

vi.mock('../../server/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Circuit Breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('ska börja i CLOSED state och tillåta anrop', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 10000, name: 'TestAPI' });
    const action = vi.fn().mockResolvedValue('success');

    const result = await cb.fire(action);
    expect(result).toBe('success');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('ska slå om till OPEN efter att failureThreshold nåtts', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10000, name: 'TestAPI' });
    const action = vi.fn().mockRejectedValue(new Error('API Down'));

    await expect(cb.fire(action)).rejects.toThrow('API Down');
    expect(cb.getState()).toBe('CLOSED'); // Fortfarande stängd (1 av 2)

    await expect(cb.fire(action)).rejects.toThrow('API Down');
    expect(cb.getState()).toBe('OPEN'); // Nu bröt den (2 av 2)

    // Tredje anropet blockeras direkt, action anropas inte!
    action.mockClear();
    await expect(cb.fire(action)).rejects.toThrow('is OPEN. Request blocked');
    expect(action).not.toHaveBeenCalled();
  });

  it('ska gå till HALF_OPEN och återhämta sig efter timeout', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000, name: 'TestAPI' });
    const failingAction = vi.fn().mockRejectedValue(new Error('API Down'));

    await expect(cb.fire(failingAction)).rejects.toThrow('API Down');
    expect(cb.getState()).toBe('OPEN');

    // Snabbspola tiden framåt förbi timeouten
    vi.advanceTimersByTime(6000);

    // Nu bör den tillåta ett anrop och gå till HALF_OPEN, och om det lyckas, gå tillbaka till CLOSED
    const successAction = vi.fn().mockResolvedValue('success');
    const result = await cb.fire(successAction);

    expect(result).toBe('success');
    expect(successAction).toHaveBeenCalled();
    expect(cb.getState()).toBe('CLOSED');
  });
});
